#!/usr/bin/env python3
"""Fetch Goodreads shelf RSS feeds and write a clean books.json for the display page.

Standard library only. No dependencies to install.
"""

import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

# Add or remove people here. The name is what appears on screen.
READERS = [
    {"name": "Vince", "user_id": "166663242"},
    {"name": "Missy", "user_id": "78748822"},
]

SHELF = "read"

FEED_TEMPLATE = "https://www.goodreads.com/review/list_rss/{}?shelf={}"
OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "books.json"
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


def text_of(item, tag):
    node = item.find(tag)
    if node is None or node.text is None:
        return ""
    return node.text.strip()


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


def parse_date(value):
    """Goodreads emits RFC-822-ish dates. Return a datetime or None."""
    if not value:
        return None
    cleaned = re.sub(r"\s*[-+]\d{4}$", "", value).strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S", "%a, %d %b %Y"):
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None


def date_label(reader, read_at, date_added):
    """Prefer the date read. Fall back to the date added, labelled honestly."""
    read = parse_date(read_at)
    if read:
        return "{} read {} {}".format(reader, MONTHS[read.month - 1], read.year)

    added = parse_date(date_added)
    if added:
        return "{} added {} {}".format(reader, MONTHS[added.month - 1], added.year)

    return reader


def page_count(item):
    """Return pages as an integer, or 0 when Goodreads doesn't supply one."""
    raw = text_of(item, ".//num_pages")
    if raw.isdigit():
        return int(raw)
    return 0


def best_cover(item):
    """The large image is full resolution. Fall back down the sizes if absent."""
    for tag in (
        "book_large_image_url",
        "book_medium_image_url",
        "book_image_url",
        "book_small_image_url",
    ):
        url = text_of(item, tag)
        if url and "nophoto" not in url:
            return url
    return ""


def fetch(url):
    request = urllib.request.Request(
        url, headers={"User-Agent": "shelf-display/1.0"}
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def books_for(reader):
    """Return every book on one person's shelf, or None if the feed failed."""
    url = FEED_TEMPLATE.format(reader["user_id"], SHELF)

    try:
        raw = fetch(url)
    except Exception as error:
        print("Could not reach {}'s feed: {}".format(reader["name"], error),
              file=sys.stderr)
        return None

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as error:
        print("{}'s feed was not valid XML: {}".format(reader["name"], error),
              file=sys.stderr)
        return None

    found = []
    for item in root.iter("item"):
        title, subtitle, series = split_title(text_of(item, "title"))
        if not title:
            continue

        try:
            rating = int(text_of(item, "user_rating") or 0)
        except ValueError:
            rating = 0

        pages = page_count(item)

        found.append(
            {
                "id": "{}-{}".format(reader["user_id"], text_of(item, "book_id")),
                "reader": reader["name"],
                "title": title,
                "subtitle": subtitle,
                "series": series,
                "author": text_of(item, "author_name"),
                "rating": rating,
                "date": date_label(
                    reader["name"],
                    text_of(item, "user_read_at"),
                    text_of(item, "user_date_added"),
                ),
                "pages": "{} pages".format(pages) if pages else "",
                "cover": best_cover(item),
            }
        )

    if not found:
        print(
            "{}'s feed came back empty. Is the profile set to public?".format(
                reader["name"]
            ),
            file=sys.stderr,
        )
        return None

    print("{}: {} books".format(reader["name"], len(found)))
    return found


def main():
    books = []

    for reader in READERS:
        found = books_for(reader)
        if found is None:
            # Bail out rather than publish half a shelf.
            print("Leaving books.json alone.", file=sys.stderr)
            return 1
        books.extend(found)

    payload = {
        "updated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
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
