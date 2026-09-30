# balkhaev.com

A black hole and two ways to get in touch. Static HTML, CSS and TypeScript; no backend or runtime framework.

The renderer originated in the owner's Montage site at commit `184f50fc547d`. The page now renders disk, stars and both contacts in one Schwarzschild scene. There are no screen-space gravity filters, cursor forces, drag waves or independently animated HTML labels.

## Scene and interaction

Drag or use arrow keys to change the observer's viewpoint. Wheel, pinch or +/- changes optical zoom; Home resets the view. Tab selects a native contact link and follows its moving image; Enter opens it, Escape returns to the scene. Hover only indicates selection and never stops an orbit.

The contacts are double-sided emissive test surfaces outside the disk, with circular geodesic centres and prescribed attitude stabilization in their polar orbital plane. Light rays intersect the disk and contact plane in distance order. The same integrated null geodesics provide multiple images, horizon capture and the background stars. Coordinate travel time is integrated alongside each ray, so each surface intersection uses its own emission time. Picking follows the same curved ray and emission time, including secondary images.

The disk starts at the Schwarzschild ISCO, 3 horizon radii, and uses a zero-torque relativistic thin-disk temperature profile. Passive circular tracers modulate opacity. Frequency shifts include the emitter's motion and the observer's gravitational potential; Planck radiance is sampled at the shifted temperature. The two contact surfaces use the local metric and their prescribed coordinate velocities across the full surface. Spatial sizes and orbital rates never depend on viewport dimensions. Narrow screens change optical framing instead.

This is a test-body, prescribed-emission model, not a full plasma or structural simulation: disk/contact self-gravity, magnetic fields, material stresses, radiative feedback and black-hole rotation are omitted. Camera navigation selects stationary observers at 60 horizon radii; it does not model a spacecraft flight or its accelerations. Units are r_s and r_s/c, with one common display clock at 3.8 units per second. The ray table, 2–3 retained images, three spectral colour samples, finite star filter and display tone mapping introduce numerical/rendering approximations. These assumptions are intentional; this is not claimed to simulate all astrophysics exactly.

Ray-table rendering follows [Eric Bruneton, Real-time High-Quality Rendering of Non-Rotating Black Holes](https://arxiv.org/abs/2010.08735).

## Development

```sh
bun install
bun run dev
```

Open `http://localhost:4175`. Rebuild with `bun run build` after edits. `bun run check` runs TypeScript and Ultracite; `bun test` checks light deflection/capture, light travel time against independent radial quadrature, orbit invariants, camera bases, curved-ray picking, mobile framing and adaptive quality.

Animation pauses in a hidden tab and respects reduced motion. The contact links and a static fallback remain available without WebGL.

The renderer adapts resolution, bloom levels and tracer count (4,500 / 12,000 / 28,000) to GPU performance. Reduced-motion mode holds the simulation at a fixed time while allowing explicit camera navigation. Hidden tabs pause the display clock. Native contact anchors remain keyboard and screen-reader accessible, and become visible if WebGL is unavailable or lost.

## Production

Coolify serves an Nginx image on `https://balkhaev.com`. DNS points to `49.13.216.63`. The Docker image listens on port 8080; TLS is handled by Coolify.

After committing and pushing, run `bun run deploy` with `COOLIFY_ACCESS_TOKEN` set and SSH key access to `root@49.13.216.63`. Deployment builds the committed revision on the server, tags the image with the commit for rollback, and deploys that image. No credentials are stored in this repository.
