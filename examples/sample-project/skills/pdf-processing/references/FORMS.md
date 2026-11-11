# Form guide

PDF forms come in two flavours. Identify which one you have before writing.

## AcroForm

The common case. Fields have names and types.

| Type       | Value format              |
| ---------- | ------------------------- |
| Text       | Plain string              |
| Checkbox   | `/Yes` or `/Off`          |
| Radio      | The export value          |
| Choice     | One of the listed options |

Use `scripts/fill_form.py --list` to print every field name.

## XFA

XML-based and rarely supported. Tell the user the form must be flattened first.

## Checklist

1. Field names are case-sensitive.
2. Dates follow the format shown in the field tooltip.
3. Re-open the output and compare against [the layout reference](layout.md).
