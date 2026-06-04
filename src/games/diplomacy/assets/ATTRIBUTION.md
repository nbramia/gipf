# Diplomacy map — attribution & license

The province geometry and piece coordinates used by the Diplomacy board are
derived from the **jDip "Detailed Standard Map"**:

- **SVG / vector map:** Zach DelProposto (the jDip project)
- **Source:** https://github.com/diplomacy/diplomacy (`diplomacy/maps/svg/standard.svg`)
- **License:** **GNU General Public License (GPL)**

`jdip-standard.svg` in this directory is the upstream file, unmodified, retained
as the build source. `scripts/diplomacy-extract-jdip.mjs` extracts only the
vector province boundaries and the per-province piece/supply/label coordinates
into `../mapGeometry.js`; the original background bitmap (by J. Fatula III) is
**not** used, and all colours/styling are our own.

## License note

This map asset (`jdip-standard.svg` and the geometry derived from it in
`mapGeometry.js`) is licensed under the **GPL**, separately from the rest of this
project, which is MIT. The GPL applies to this map component and its
derivatives. If you redistribute it, comply with the GPL (retain this notice and
make the corresponding source available).

To regenerate `mapGeometry.js` from the source SVG:

```bash
node scripts/diplomacy-extract-jdip.mjs
```
