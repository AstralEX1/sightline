# Background video credits

All three clips come from Mixkit under the **Mixkit Stock Video Free License**
(https://mixkit.co/license/#videoFree): free for commercial and personal use, no attribution
required, no sign-up. Credits are kept here for our own records. The raw downloads were the
720p mp4s from `https://assets.mixkit.co/videos/<id>/<id>-720.mp4`.

| File | Scene | Source page | Author (Mixkit contributor) | License |
|---|---|---|---|---|
| street.mp4 / street.jpg | street: POV walk down a sunny town street | https://mixkit.co/free-stock-video/walking-through-the-streets-of-a-tourist-town-2593/ | matthiasgroeneveld (https://mixkit.co/@matthiasgroeneveld/) | Mixkit Stock Video Free License |
| cafe.mp4 / cafe.jpg | cafe: view across an empty restaurant/café room towards the window, slow pan | https://mixkit.co/free-stock-video/classically-styled-restaurant-4195/ | dubassy (https://mixkit.co/@dubassy/) | Mixkit Stock Video Free License |
| park.mp4 / park.jpg | park: POV walk down a tree-lined park path | https://mixkit.co/free-stock-video/slowly-walking-down-a-path-in-a-park-40656/ | edgarfernandez (https://mixkit.co/@edgarfernandez/) | Mixkit Stock Video Free License |

## Processing

Output: H.264 (libx264, yuv420p, +faststart), no audio, 960x540, 24 fps, gblur sigma 16, darkened.
Each loop is the segment `[start+0.5 s, start+len+0.5 s]` with its last 0.5 s crossfaded into
the segment's first 0.5 s, so the last frame flows into the first.

- street: source 0:02–0:18.5, extra darkening (brightness -0.12) because the walls are light.
- cafe: source 0:06–0:22.5, extra multiplicative darkening (`colorlevels` max 0.6) because the room and window are near white.
- park: whole 12 s clip slowed 5 % (source is vertical 720x1280, so the crop is moved down to keep the path and horizon in frame).

```sh
# street.mp4 (from mixkit-2593-720.mp4)
ffmpeg -i mixkit-2593-720.mp4 -filter_complex "[0:v]trim=start=2:duration=16.500,setpts=(PTS-STARTPTS)*1,fps=24,scale=960:540:force_original_aspect_ratio=increase,crop=960:540,gblur=sigma=16,eq=brightness=-0.12:saturation=0.85,format=yuv420p,split[a][b];[a]trim=start=0.5,setpts=PTS-STARTPTS[a1];[b]trim=end=0.5,setpts=PTS-STARTPTS[b1];[a1][b1]xfade=transition=fade:duration=0.5:offset=15.5,format=yuv420p" -an -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -r 24 -movflags +faststart street.mp4

# cafe.mp4 (from mixkit-4195-720.mp4)
ffmpeg -i mixkit-4195-720.mp4 -filter_complex "[0:v]trim=start=6:duration=16.500,setpts=(PTS-STARTPTS)*1,fps=24,scale=960:540:force_original_aspect_ratio=increase,crop=960:540,gblur=sigma=16,colorlevels=romax=0.6:gomax=0.6:bomax=0.6,eq=brightness=-0.06:saturation=0.85,format=yuv420p,split[a][b];[a]trim=start=0.5,setpts=PTS-STARTPTS[a1];[b]trim=end=0.5,setpts=PTS-STARTPTS[b1];[a1][b1]xfade=transition=fade:duration=0.5:offset=15.5,format=yuv420p" -an -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -r 24 -movflags +faststart cafe.mp4

# park.mp4 (from mixkit-40656-720.mp4)
ffmpeg -i mixkit-40656-720.mp4 -filter_complex "[0:v]trim=start=0:duration=11.905,setpts=(PTS-STARTPTS)*1.05,fps=24,scale=960:540:force_original_aspect_ratio=increase,crop=960:540:0:850,gblur=sigma=16,eq=brightness=-0.06:saturation=0.85,format=yuv420p,split[a][b];[a]trim=start=0.5,setpts=PTS-STARTPTS[a1];[b]trim=end=0.5,setpts=PTS-STARTPTS[b1];[a1][b1]xfade=transition=fade:duration=0.5:offset=11.5,format=yuv420p" -an -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -r 24 -movflags +faststart park.mp4

# posters (first frame of each output)
ffmpeg -i <scene>.mp4 -frames:v 1 -q:v 4 <scene>.jpg
```
