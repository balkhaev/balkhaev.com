# balkhaev.com

A black hole and two ways to get in touch. Static HTML, CSS and TypeScript; no backend or runtime framework.

The renderer originated in the owner's Montage site at commit `184f50fc547d`. The page now renders disk, stars and both contacts in one Schwarzschild scene. There are no screen-space gravity filters, cursor forces, drag waves or independently animated HTML labels.

## Scene and interaction

The initial observer is 12.5 horizon radii from the centre, six degrees above the accretion disk plane. The lens has a fixed 56-degree field of view on the shorter screen dimension. Drag or use arrow keys to look freely through 360 degrees; the mouse changes orientation, not the position of the black hole. Scroll down, spread two fingers, or press + to advance into the scene. Scroll up, pinch or - rewinds the approach outside the horizon. Home, Escape, or the visible restart button starts a new flight. Tab aims toward a contact and reveals its native link for reliable keyboard access; Enter opens it.

The first scroll starts a radial free-fall sequence. Scroll controls progress along that worldline; a slow forward playback continues between gestures, with display speed reduced near the centre to allow time to look around. World time advances by the observer's proper-time increment, so accelerated playback advances the emitters consistently. Reversing scroll after horizon crossing cannot move the observer outward. Restart selects the initial scene; it is not a physical escape from the black hole. The visual model stops at r = 0.2 r_s, before the singularity. Reduced motion disables autonomous movement, while explicit flight and look controls still work. The idle opening samples successive rain observers at the same location until a flight begins.

## Relativistic rendering

The renderer uses ingoing Painleve–Gullstrand coordinates, regular across the future event horizon, with metric ds² = -dT² + (dr + sqrt(1/r) dT)² + r² dΩ² in r_s = c = 1 units. The observer follows dr/dτ = -1/sqrt(r), dT/dτ = 1. Past-directed photons start in that observer's local orthonormal frame. Their conserved energy and angular momentum initialize u'' = -u + 3u²/2, with a rationalized PG travel-time equation that remains finite at the horizon for light arriving from outside.

The ray table is rebuilt for the actual camera radius. Rows cover the entire local sky with more samples near the escape-cone boundary; each row's angular samples span its own path length. The same curved rays intersect the disk, contact surfaces and moving stellar photosphere in ray order. They provide delayed emission times, multiple images, capture and a lensed distant star field on both sides of the horizon. Frequency shifts use the photon covector contracted with each emitter's velocity and the observer's local frequency. There is no artificial fade, clipping plane or replacement sky at r = 1.

The disk spans radii 3–11 and uses a zero-torque Schwarzschild thin-disk temperature profile peaking at 5,400 K. Circular tracers and advected filaments modulate opacity. A compact 11,800 K star follows a bound eccentric geodesic between radii 12 and 32, with a prescribed coordinate photosphere radius of 0.34. Darwin's anomaly is integrated in PG time; the accumulated azimuth preserves relativistic precession between radial periods. Both contacts are double-sided emissive test surfaces outside the disk, with circular geodesic centres in an inclined plane and prescribed attitude stabilization. Their positions never depend on viewport dimensions. Optical bloom redistributes a fraction of image energy over normalized blur kernels before tone mapping.

This is a test-body, prescribed-emission model. It omits black-hole rotation, self-gravity, plasma dynamics, structural stresses, tidal deformation and radiative feedback. The compact star's coordinate sphere and limb-darkening law are approximations. Finite ray/orbit tables, retained image count, three spectral samples, filtering and display tone mapping introduce numerical approximations. The singularity itself is outside the model.

The table approach follows [Eric Bruneton](https://arxiv.org/abs/2010.08735). The falling frame and horizon-regular coordinates follow the [river model of black holes](https://arxiv.org/abs/gr-qc/0411060). Eccentric orbit equations use the Darwin parameterization in [Hopper, Kavanagh and Ottewill, equations 2.5–2.6](https://link.aps.org/accepted/10.1103/PhysRevD.93.044010), transformed to PG time.

## Development

```sh
bun install
bun run dev
```

Open `http://localhost:4175`. Rebuild with `bun run build` after edits. `bun run check` runs TypeScript and Ultracite; `bun test` checks light deflection/capture, null momentum, horizon continuity, interior light travel time against independent radial quadrature, timelike flight, one-way horizon controls, orbit invariants, camera bases, curved-ray picking and adaptive quality.

Animation pauses in a hidden tab and respects reduced motion. The contact links and a static fallback remain available without WebGL.

The renderer adapts resolution, bloom levels and tracer count (4,500 / 12,000 / 28,000) to GPU performance. Reduced-motion mode holds the simulation at a fixed time while allowing explicit camera navigation. Hidden tabs pause the display clock. Native contact anchors remain keyboard and screen-reader accessible, and become visible if WebGL is unavailable or lost.

## Production

Coolify serves an Nginx image on `https://balkhaev.com`. DNS points to `49.13.216.63`. The Docker image listens on port 8080; TLS is handled by Coolify.

After committing and pushing, run `bun run deploy` with `COOLIFY_ACCESS_TOKEN` set and SSH key access to `root@49.13.216.63`. Deployment builds the committed revision on the server, tags the image with the commit for rollback, and deploys that image. No credentials are stored in this repository.
