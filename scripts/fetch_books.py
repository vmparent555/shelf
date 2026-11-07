#!/usr/bin/env python3
"""Fetch Goodreads shelves and write a clean books.json for the display page.

Goodreads retired its RSS feeds in October 2026, so this reads each person's
public shelf widget instead (the embeddable shelf Goodreads still serves).

The widget has no read dates and no page counts, so:
  * Books already in books.json keep the date and page count they had.
  * New books get a read date from Goodreads' public "recent updates" widget
    when it has one, and an honest "added <month>" label when it doesn't.
  * Missing page counts are looked up on Open Library (free, no key).
  * Optional monthly boost: drop a Goodreads export into the exports/ folder
    (exports/vince.csv, exports/missy.csv) and exact read dates, page counts
    and ratings from the export win over everything above.

Standard library only. No dependencies to install.
"""

import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

# Add or remove people here. The name is what appears on screen.
READERS = [
    {"name": "Vince", "user_id": "166663242"},
    {"name": "Missy", "user_id": "78748822"},
]

SHELF = "read"
NUM_BOOKS = 100          # the widget returns at most about this many
KEEP_OLD_BOOKS = True    # keep books that are in books.json but past the widget's cap

WIDGET_URL = "https://www.goodreads.com/review/custom_widget/{}"
UPDATES_URL = "https://www.goodreads.com/widgets/user_update_widget"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.path.join(REPO_ROOT, "books.json")
EXPORT_DIR = os.path.join(REPO_ROOT, "exports")

OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json"
OPEN_LIBRARY_AGENT = "shelf-display/1.0 (personal book display; github.com/vmparent555/shelf)"
MAX_PAGE_LOOKUPS = 40    # per run, so a big backlog fills in over a few days
LOOKUP_PAUSE_SECONDS = 1.0

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)

# A trailing parenthetical is nearly always series information on Goodreads:
#   "Words of Radiance (The Stormlight Archive, #2)"
#   "Cataclysm (Star Wars: The High Republic)"
SERIES_RE = re.compile(r"\s*\(([^()]+)\)\s*$")

# Only pull a subtitle off the front of a colon when the title is long enough
# that it needs the help. Keeps "Star Wars: Rebel Rising" intact.
SUBTITLE_MIN_LENGTH = 45

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


# ---------------------------------------------------------------- titles

def split_title(raw):
    """Return (title, subtitle, series) from a raw Goodreads title string."""
    series = ""
    title = raw.strip()

    match = SERIES_RE.search(title)
    if match:
        series = match.group(1).strip()
        title = SERIES_RE.sub("", title).strip()

    subtitle = ""
    if len(title) > SUBTITLE_MIN_LENGTH and ": " in title:
        head, tail = title.split(": ", 1)
        # Guard against chopping a short franchise prefix like "Star Wars: ..."
        if len(head) >= 12:
            title, subtitle = head.strip(), tail.strip()

    return title, subtitle, series


def tidy_author(name):
    """Widgets sometimes show 'Last, First'. Flip that to 'First Last'."""
    name = name.strip()
    match = re.match(r"^([^,]+),\s*([^,]+)$", name)
    if match:
        return "{} {}".format(match.group(2).strip(), match.group(1).strip())
    return name


def norm_key(title, author):
    """Same book, however the title or author happens to be punctuated."""
    t = " ".join(re.findall(r"[a-z0-9]+", title.lower()))
    a = " ".join(sorted(re.findall(r"[a-z0-9]+", author.lower())))
    return (t, a)


# ---------------------------------------------------------------- dates

def month_label(reader, verb, month, year):
    return "{} {} {} {}".format(reader, verb, MONTHS[month - 1], year)


def parse_update_date(text, now):
    """'October 29' or 'December 12, 2025' from the updates widget."""
    text = text.strip()
    has_year = re.search(r"\d{4}", text) is not None
    for fmt in ("%B %d, %Y", "%B %d %Y"):
        try:
            d = datetime.strptime(text, fmt)
            return d.month, d.year
        except ValueError:
            pass
    try:
        d = datetime.strptime("{} {}".format(text, now.year), "%B %d %Y")
    except ValueError:
        return None
    if not has_year and d > now.replace(tzinfo=None):
        # a yearless date can't be in the future, so it's from last year
        d = d.replace(year=d.year - 1)
    return d.month, d.year


# ---------------------------------------------------------------- network

def fetch(url, agent=USER_AGENT):
    request = urllib.request.Request(url, headers={"User-Agent": agent})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8", "replace")


def widget_html(script):
    """The widget is a script holding the shelf HTML as an escaped string."""
    match = re.search(r"var widget_code = '([\s\S]*?)'(?:\r?\n|\s*$)", script)
    if not match:
        return None
    text = match.group(1).replace("\\n", "\n")
    return re.sub(r"\\(.)", r"\1", text, flags=re.S)


# ---------------------------------------------------------------- shelf parsing

VOID_TAGS = {"img", "br", "hr", "input", "meta", "link", "area", "base", "col", "wbr"}


class ShelfParser(HTMLParser):
    """Collect one record per book from the widget's HTML."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.cur = None
        self.stack = []
        self.in_author_link = False

    def _inside(self, flag):
        return any(flag in flags for _, flags in self.stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = (a.get("class") or "").split()

        def has(prefix):
            return any(c.startswith(prefix) for c in classes)

        if tag not in VOID_TAGS:
            flags = set()
            if has("gr_custom_each_container"):
                flags.add("item")
                self.cur = {"title": "", "href": "", "img": "", "author": "", "stars": 0}
                self.items.append(self.cur)
            if has("gr_custom_book_container"):
                flags.add("book")
            if has("gr_custom_author"):
                flags.add("author")
            self.stack.append((tag, flags))

        if self.cur is None:
            return

        if tag == "a" and self._inside("book") and not self.cur["href"]:
            self.cur["href"] = a.get("href") or ""
            self.cur["title"] = (a.get("title") or "").strip()
        elif tag == "a" and self._inside("author"):
            self.in_author_link = True
        elif tag == "img":
            src = a.get("src") or ""
            if "star_active" in src:
                self.cur["stars"] += 1
            elif self._inside("book") and not self.cur["img"]:
                self.cur["img"] = src

    def handle_endtag(self, tag):
        if tag == "a":
            self.in_author_link = False
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.in_author_link and self.cur is not None:
            self.cur["author"] += data


def parse_shelf(html):
    parser = ShelfParser()
    parser.feed(html)
    return [
        item for item in parser.items
        if item["title"] and item["img"] and "nophoto" not in item["img"]
    ]


def cover_id(url):
    """Book ID from a cover URL like .../books/1761194644l/243042929._SX98_.jpg"""
    match = re.search(r"/(\d+)(?:\._[^/]*)?\.\w+$", url)
    return match.group(1) if match else None


def full_cover(url):
    """Drop the size suffix to get the full-resolution cover."""
    return re.sub(r"\._S[XY]\d+_", "", url)


# ---------------------------------------------------------------- updates widget

def fetch_rating_dates(user_id, now):
    """Return {book id: (month, year)} for recently rated books. Best effort."""
    url = UPDATES_URL + "?" + urllib.parse.urlencode(
        {"user": user_id, "num_updates": "10"}
    )
    try:
        html = fetch(url)
    except Exception as error:
        print("  (updates widget unavailable: {})".format(error), file=sys.stderr)
        return {}

    dates = {}
    current = None  # only the first update of each day carries a date
    chunks = re.split(r"(?=<div[^>]*class=[\"'][^\"']*\bupdate\b[^\"']*[\"'])", html)
    for chunk in chunks[1:]:
        day = re.search(
            r"<p[^>]*>\s*([A-Z][a-z]+ \d{1,2}(?:,\s*\d{4})?)\s*</p>", chunk
        )
        if day:
            current = parse_update_date(day.group(1), now)

        action = re.search(r"class=[\"']updateAction[\"']", chunk)
        action_text = ""
        if action:
            action_text = re.sub(r"<[^>]+>", " ", chunk[action.start():action.start() + 800])
        image = re.search(
            r"class=[\"']updateImage[\"'][\s\S]*?<img[^>]+src=[\"']([^\"']+)[\"']", chunk
        )
        book = cover_id(image.group(1)) if image else None

        if current and book and "rated a book" in action_text and book not in dates:
            dates[book] = current
    return dates


# ---------------------------------------------------------------- one reader

def old_index(old_books):
    by_id, by_key = {}, {}
    for book in old_books:
        by_id[book.get("id", "")] = book
        by_key[norm_key(book.get("title", ""), book.get("author", ""))] = book
    return by_id, by_key


def books_for(reader, old_books, now):
    """Return this person's books, or None if the widget couldn't be read."""
    name, user_id = reader["name"], reader["user_id"]

    params = urllib.parse.urlencode({
        "shelf": SHELF,
        "num_books": NUM_BOOKS,
        "sort": "date_read",
        "order": "d",
        # Goodreads caches a widget by its ID and ignores other settings on a
        # repeat request, so every run asks with a brand-new ID.
        "widget_id": "{}-{}-{}".format(SHELF, user_id, int(time.time() * 1000)),
    })
    url = WIDGET_URL.format(user_id) + "?" + params

    try:
        script = fetch(url)
    except Exception as error:
        print("Could not reach {}'s shelf widget: {}".format(name, error),
              file=sys.stderr)
        return None

    html = widget_html(script)
    if not html:
        print("{}'s shelf widget had no shelf in it.".format(name), file=sys.stderr)
        return None

    parsed = parse_shelf(html)
    if not parsed:
        print(
            "{}'s shelf widget had no books. Is the profile public?".format(name),
            file=sys.stderr,
        )
        return None

    rating_dates = fetch_rating_dates(user_id, now)
    by_id, by_key = old_index(old_books)

    result, seen_ids = [], set()
    matched = 0
    for item in parsed:
        title, subtitle, series = split_title(item["title"])
        author = tidy_author(item["author"])
        bid = cover_id(item["img"])
        if not bid:
            review = re.search(r"/review/show/(\d+)", item["href"])
            bid = "r" + review.group(1) if review else ""
        new_id = "{}-{}".format(user_id, bid)

        old = by_id.get(new_id) or by_key.get(norm_key(title, author))
        if old:
            matched += 1
            book = dict(old)
            # The widget may show only whole stars, so don't let it flatten a
            # quarter-star rating (say 3.25) back to 3. A change of a full
            # star or more still wins.
            if item["stars"] > 0 and abs((book.get("rating") or 0) - item["stars"]) >= 1:
                book["rating"] = item["stars"]
        else:
            if bid in rating_dates:
                month, year = rating_dates[bid]
                date = month_label(name, "read", month, year)
            else:
                date = month_label(name, "added", now.month, now.year)
            book = {
                "id": new_id,
                "reader": name,
                "title": title,
                "subtitle": subtitle,
                "series": series,
                "author": author,
                "rating": item["stars"],
                "date": date,
                "pages": "",
                "cover": full_cover(item["img"]),
            }

        if book["id"] in seen_ids:
            continue
        seen_ids.add(book["id"])
        result.append(book)

    kept = 0
    if KEEP_OLD_BOOKS:
        for book in old_books:
            if book.get("id") not in seen_ids:
                result.append(book)
                seen_ids.add(book.get("id"))
                kept += 1

    print("{}: {} from the widget ({} already known, {} new), {} kept from before".format(
        name, len(parsed), matched, len(parsed) - matched, kept))
    return result


# ---------------------------------------------------------------- Goodreads export (CSV)

def load_export(reader):
    """Rows from exports/<name>.csv, or [] if there isn't one."""
    if not os.path.isdir(EXPORT_DIR):
        return [], ""
    name = reader["name"].lower()
    files = sorted(
        f for f in os.listdir(EXPORT_DIR)
        if f.lower().endswith(".csv") and name in f.lower()
    )
    if not files:
        return [], ""
    path = os.path.join(EXPORT_DIR, files[-1])
    try:
        with open(path, newline="", encoding="utf-8-sig") as handle:
            return list(csv.DictReader(handle)), files[-1]
    except (OSError, csv.Error) as error:
        print("Could not read {}: {}".format(path, error), file=sys.stderr)
        return [], ""


def parse_rating(value):
    """'3.25' -> 3.25, '4' -> 4, junk -> 0. Goodreads uses quarter stars now."""
    try:
        number = float((value or "").strip())
    except ValueError:
        return 0
    number = round(min(max(number, 0), 5) * 4) / 4
    return int(number) if number == int(number) else number


def read_month(value):
    """'2026/03/14' (Goodreads export style) -> (3, 2026), or None."""
    match = re.search(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", value or "")
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    return (month, year) if 1 <= month <= 12 else None


def apply_export(books, rows, reader):
    """Exact dates, pages and ratings from a Goodreads export win."""
    name, user_id = reader["name"], reader["user_id"]
    by_id, by_key = {}, {}
    for row in rows:
        if (row.get("Exclusive Shelf") or "").strip().lower() != SHELF:
            continue
        title, _, _ = split_title(row.get("Title") or "")
        if not title:
            continue
        pages = (row.get("Number of Pages") or "").strip()
        record = {
            "pages": int(pages) if pages.isdigit() else 0,
            "rating": parse_rating(row.get("My Rating")),
            "read": read_month(row.get("Date Read")),
        }
        book_id = (row.get("Book Id") or "").strip()
        if book_id:
            by_id["{}-{}".format(user_id, book_id)] = record
        by_key[norm_key(title, row.get("Author") or "")] = record

    changed = 0
    for book in books:
        record = by_id.get(book["id"]) or by_key.get(
            norm_key(book["title"], book["author"])
        )
        if not record:
            continue
        if record["pages"]:
            book["pages"] = "{} pages".format(record["pages"])
        if record["rating"]:
            book["rating"] = record["rating"]
        if record["read"]:
            month, year = record["read"]
            book["date"] = month_label(name, "read", month, year)
        changed += 1
    return changed


# ---------------------------------------------------------------- page counts (Open Library)

def _words(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def lookup_pages(title, author):
    """Typical page count for a book from Open Library, or 0 if unsure."""
    query = urllib.parse.urlencode({
        "title": title,
        "author": author,
        "limit": 5,
        "fields": "title,author_name,number_of_pages_median",
    })
    data = json.loads(fetch(OPEN_LIBRARY_SEARCH + "?" + query, agent=OPEN_LIBRARY_AGENT))
    wanted = _words(title)
    for doc in data.get("docs", []):
        pages = doc.get("number_of_pages_median")
        found = _words(doc.get("title") or "")
        # the match must really be this book, not just a similar search hit
        if pages and found and (wanted <= found or found <= wanted):
            return int(pages)
    return 0


def fill_missing_pages(books):
    """Look up page counts for books that have none, a few per run."""
    looked = filled = 0
    for book in books:
        if book.get("pages") or looked >= MAX_PAGE_LOOKUPS:
            continue
        looked += 1
        try:
            pages = lookup_pages(book["title"], book.get("author", ""))
        except Exception as error:
            print("  (page lookup failed for {}: {})".format(book["title"], error),
                  file=sys.stderr)
            pages = 0
        if pages:
            book["pages"] = "{} pages".format(pages)
            filled += 1
        time.sleep(LOOKUP_PAUSE_SECONDS)
    if looked:
        print("Page lookup: tried {}, found {}.".format(looked, filled))


# ---------------------------------------------------------------- main

def load_old_books():
    """Books from the last successful run, grouped by reader name."""
    try:
        with open(OUTPUT_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    grouped = {}
    for book in data.get("books", []):
        grouped.setdefault(book.get("reader", ""), []).append(book)
    return grouped


def main():
    now = datetime.now(timezone.utc)
    old = load_old_books()
    books = []

    for reader in READERS:
        found = books_for(reader, old.get(reader["name"], []), now)
        if found is None:
            # Bail out rather than publish half a shelf.
            print("Leaving books.json alone.", file=sys.stderr)
            return 1

        rows, filename = load_export(reader)
        if rows:
            changed = apply_export(found, rows, reader)
            print("{}: {} books updated from exports/{}".format(
                reader["name"], changed, filename))
        books.extend(found)

    fill_missing_pages(books)

    payload = {
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(books),
        "books": books,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, ensure_ascii=False)
        handle.write("\n")

    print("Wrote {} books to {}".format(len(books), OUTPUT_PATH))
    return 0


if __name__ == "__main__":
    sys.exit(main())
