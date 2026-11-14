"""Experimental POS pulse-quality gate; not a validated replay detector."""
from collections import deque

import numpy as np
from scipy.signal import butter, sosfiltfilt, welch


def skin_rgb(frame, bbox):
    """Average RGB from forehead and cheeks in a BGR frame."""
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = np.asarray(bbox, dtype=int)
    x1, x2 = np.clip([x1, x2], 0, width)
    y1, y2 = np.clip([y1, y2], 0, height)
    w, h = x2 - x1, y2 - y1
    if min(w, h) < 20:
        raise ValueError("Face ROI is too small")
    regions = [(0.25, 0.15, 0.75, 0.35), (0.10, 0.50, 0.40, 0.72),
               (0.60, 0.50, 0.90, 0.72)]
    colors = []
    for left, top, right, bottom in regions:
        roi = frame[y1 + int(top*h):y1 + int(bottom*h),
                    x1 + int(left*w):x1 + int(right*w)]
        colors.append(roi.mean(axis=(0, 1))[::-1])
    return np.mean(colors, axis=0)


class PulseGate:
    """One instance per continuous face track; reset on loss or identity change."""

    def __init__(self, fps=30.0, window=120, stride=15, min_snr=2.2):
        if fps <= 5 or window < 60 or stride < 1:
            raise ValueError("Invalid pulse window settings")
        self.fps, self.window, self.stride, self.min_snr = fps, window, stride, min_snr
        self.reset()

    def reset(self):
        self.samples = deque(maxlen=self.window)
        self.times = deque(maxlen=self.window)
        self.bpms = deque(maxlen=3)
        self.count = 0
        self.result = {"status": "COLLECTING", "bpm": None, "snr_db": None}

    def update(self, rgb, timestamp):
        rgb = np.asarray(rgb, dtype=float)
        if rgb.shape != (3,) or not np.isfinite(rgb).all() or np.any(rgb <= 0):
            raise ValueError("RGB must contain three positive finite values")
        if not np.isfinite(timestamp):
            raise ValueError("Timestamp must be finite")
        if self.times:
            gap = timestamp - self.times[-1]
            if gap <= 0:
                raise ValueError("Timestamps must increase")
            if abs(gap - 1/self.fps) > 0.5/self.fps:
                self.reset()
        self.samples.append(rgb)
        self.times.append(timestamp)
        self.count += 1
        if len(self.samples) < self.window:
            return dict(self.result)
        if (self.count - self.window) % self.stride:
            return dict(self.result)
        colors = np.asarray(self.samples)
        # POS projection after temporal channel normalization.
        normalized = colors / colors.mean(axis=0) - 1
        red, green, blue = normalized.T
        s1, s2 = green-blue, green+blue-2*red
        pulse = s1 + s1.std() / max(s2.std(), 1e-12) * s2
        pulse = sosfiltfilt(butter(3, [0.75, 2.5], btype="bandpass",
                                  fs=self.fps, output="sos"), pulse)
        freq, power = welch(pulse, fs=self.fps, nperseg=len(pulse), nfft=2048)
        band = (freq >= 0.75) & (freq <= 2.5)
        peak = freq[band][np.argmax(power[band])]
        signal = band & ((abs(freq-peak) <= 0.15) | (abs(freq-2*peak) <= 0.15))
        energy = power[band].sum()
        snr = float(10*np.log10(max(power[signal].sum(), 1e-20) /
                               max(power[band & ~signal].sum(), 1e-20)))
        bpm = float(peak*60)
        self.bpms.append(bpm)
        status = "COLLECTING"
        if energy < 1e-12 or snr < self.min_snr:
            status = "FAKE"
            self.bpms.clear()
        elif len(self.bpms) == 3:
            status = "REAL" if np.std(self.bpms) <= 10 else "FAKE"
        self.result = {"status": status, "bpm": bpm, "snr_db": snr}
        return dict(self.result)
