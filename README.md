# balkhaev.com

A black hole and two ways to get in touch. Static HTML, CSS and TypeScript; no backend or runtime framework.

The renderer and interaction modules are adapted from the owner's Montage site at commit `184f50fc547d`: relativistic disk lensing, GPU particles and cooling pointer wakes, drag inertia, gravitational waves that distort stars and links, gentle attraction, and adaptive detail (4,500 / 12,000 / 28,000 particles).

## Development

```sh
bun install
bun run dev
```

Open `http://localhost:4175`. Rebuild with `bun run build` after edits. `bun run check` runs TypeScript and Ultracite; `bun test` checks the geodesics and adaptive quality/attraction bounds.

Animation pauses in a hidden tab and respects reduced motion. The contact links and a static fallback remain available without WebGL.

## Production

Coolify serves an Nginx image on `https://balkhaev.com`. DNS points to `49.13.216.63`. The Docker image listens on port 8080; TLS is handled by Coolify.

After committing and pushing, run `bun run deploy` with `COOLIFY_ACCESS_TOKEN` set and SSH key access to `root@49.13.216.63`. Deployment builds the committed revision on the server, tags the image with the commit for rollback, and deploys that image. No credentials are stored in this repository.
