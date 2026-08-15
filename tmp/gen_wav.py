import math, struct, wave

path = "/data/music/music/test-song.wav"
sr = 8000
dur = 6.0
n = int(sr * dur)
with wave.open(path, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    frames = bytearray()
    for i in range(n):
        t = i / sr
        # 440Hz 正弦 + 轻微衰减，避免纯静音
        v = 0.5 * math.sin(2 * math.pi * 440 * t) * (1.0 - 0.3 * (t / dur))
        frames += struct.pack("<h", int(v * 32767))
    w.writeframes(bytes(frames))
print("written", path)
