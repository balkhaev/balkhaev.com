# /land/ first-screen comparison

The two WebP images are renders of the same existing `plan` scene, not
imagery from a different location. Both use a 1480 × 920 viewport and the
same camera: target [-1.35, 1.5, 4.5], yaw 0.63, elevation 0.64, distance 19;
daylight 0.52. The terrain view disables future buildings and the plan overlay.
The proposal enables both without moving the camera.

For the SVG, use each original parcel's world outline from the renderer.
Project its vertices at groundAt(x, z) + 0.035 with the same camera, then
multiply normalized screen coordinates by 1480 × 920. Phase colors come
from the corresponding number in masterplan.json. The visible click target
for plot 42 is placed at the projection of its center. If the camera or
viewport changes, regenerate both images and the SVG together and update
the marker position. These are project contours, not cadastral boundaries.
