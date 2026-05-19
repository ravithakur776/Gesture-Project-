# GestureOS Studio

GestureOS Studio is a local-first hand tracking web app that turns a webcam
into a practical gesture control system. It is designed for real use, not just
visual demo effects.

## Why This Project

GestureOS Studio helps with real workflows:

- Presentation control with gesture-triggered actions
- Creator capture with gesture timeline + frame exports
- Dataset collection for computer vision and ML experiments
- Accessibility and touchless interaction prototyping

## Core Features

- Realtime webcam preview with MediaPipe Hands tracking
- Gesture detection: `Swipe`, `Pinch`, `Fist`, `Peace`, `Point`, `Open Palm`
- Studio modes: `Presenter`, `Dataset`, `Creator`
- Render styles: `Neon`, `Clean`, `Debug`
- Session timeline with gesture events and action mapping
- Calibration support for cleaner session consistency
- Export tools:
  - `PNG` for captured frames
  - `JSON` for full session and landmarks
  - `CSV` for event logs
- Local-first behavior: camera data stays in-browser unless exported

## Quick Start

```bash
cd "/Users/ravithakur/Downloads/Gesture Project "
python3 -m http.server 8081
```

Open in browser:

`http://127.0.0.1:8081`

Important:

- Use localhost for camera permission
- Do not open `index.html` directly from Finder for webcam testing

## Gesture Action Map

- `Swipe Left` -> Previous
- `Swipe Right` -> Next
- `Pinch` -> Keyframe
- `Fist` -> Marker
- `Peace` -> Highlight
- `Open Palm` -> Ready
- `Point` -> Pointer

## Keyboard Shortcuts

- `Space` -> Capture frame
- `R` -> Start or pause recording

## Troubleshooting

- Camera blocked: allow camera permission in browser settings
- Camera busy: close other apps using webcam
- Tracking not loading: check internet connectivity for MediaPipe CDN
- Blank output: run via localhost URL, not file open

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- MediaPipe Hands


