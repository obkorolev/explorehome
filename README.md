# ExploreHome apartment tour

Seven connected 360-degree photographs form an interactive apartment tour. The floor plan follows the supplied Polycam screenshot with manually corrected furniture, fixtures, doorways and viewpoint positions; it is approximate, not a measured survey. Navigation markers stay attached to their panorama locations. Phone users can swipe to look around or enable Motion controls and grant browser permission.

## Development

Use Node.js 22.12 or later. Run `npm ci`, `npm test`, then `npm run dev`. Source is in `src`, browser images and tour metadata are in `public`, and tests are in `tests`. Three.js and Vite versions are locked in `package-lock.json`. No backend, accounts or paid services are needed by the viewer.

## Publishing

GitHub Pages publishes the `docs` directory from the `main` branch. Run `npm run build`, copy the contents of `dist` into `docs`, retain `docs/.nojekyll`, then commit and push the updated source and output. Compiled assets, tour metadata and panoramas use relative links so the same build works under a project subfolder. The public site is https://obkorolev.github.io/explorehome/.

## Validation and limitations

The 21 JavaScript tests cover navigation, panorama anchor projection, capture availability, phone swipe sensitivity and simulated sensor/permission handling. Motion requires a secure context and browser sensor access; the public HTTPS link supports that requirement. Physical phone sensor behavior has not been hardware-tested. The images retain the supplied captures' resolution and stitching artifacts. This is a linked panorama tour, not reconstructed 3D geometry.
