# Review checklist

## Correctness

- Are edge cases handled (empty input, `null`, very large values)?
- Are errors propagated or swallowed?
- Do loops and recursion terminate?

## Security

- Is all external input validated?
- Are secrets kept out of logs and source?
- Do queries use parameters instead of string concatenation?

## Maintainability

- Does each function do one thing?
- Are names accurate?
- Is new behaviour covered by a test?
