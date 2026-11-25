# Fonts

Margin serves its three typefaces from this folder, so building it never needs the network.

- **Bricolage Grotesque** (variable, 200–800), by Mathieu Triay
- **Literata** (variable, 200–900, roman and italic), by TypeTogether for Google
- **Courier Prime** (400 and 700), by Alan Dague-Greene for Quote-Unquote Apps

All three are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org), which allows bundling them with software.
The files are the woff2 subsets Google Fonts serves for each family (latin, latin-ext, and others such as greek and vietnamese), named
`family-style-weight-subset.woff2`. The `@font-face` rules are in `app/styles/fonts.css`.
