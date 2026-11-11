#!/usr/bin/env python3
"""Extract text from a PDF, page by page."""

import argparse
import sys

import pdfplumber


def extract(path: str, fmt: str) -> str:
    chunks = []
    with pdfplumber.open(path) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if fmt == "markdown":
                chunks.append(f"## Page {number}\n\n{text}")
            else:
                chunks.append(text)
    return "\n\n".join(chunks)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--format", choices=["text", "markdown"], default="text")
    args = parser.parse_args()
    try:
        print(extract(args.pdf, args.format))
    except FileNotFoundError:
        print(f"error: {args.pdf} does not exist", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
