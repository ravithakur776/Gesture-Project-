# GestureOS Studio

GestureOS Studio is a local-first webcam gesture workspace. It turns hand
motion into a practical control, capture, and dataset tool that can support
presentations, creator workflows, accessibility experiments, and ML data
collection.

## Run

```bash
cd "/Users/ravithakur/Downloads/Gesture Project "
python3 -m http.server 8081
```

Open:

`http://127.0.0.1:8081`

Use the localhost URL for camera testing. Opening `index.html` directly from
Finder can block webcam permissions in some browsers.

## What Makes It Valuable

- Native browser camera startup with clear permission diagnostics
- MediaPipe hand tracking layered over a live camera preview
- Three working modes: `Presenter`, `Dataset`, and `Creator`
- Gesture command map for slide-style control and key moments
- Session recording with event timeline and gesture frequency analytics
- Calibration snapshot for session consistency
- Exportable `PNG`, `JSON`, and `CSV` assets
- Render styles: `Neon`, `Clean`, and `Debug`
- Local-first design: webcam data stays in the browser unless exported

## Gesture Actions

- `Swipe Left` -> Previous
- `Swipe Right` -> Next
- `Pinch` -> Keyframe
- `Fist` -> Marker
- `Peace` -> Highlight
- `Open Palm` -> Ready
- `Point` -> Pointer
