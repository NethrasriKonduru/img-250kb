import React, { useEffect, useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import {
  Upload, Download, RotateCcw, RotateCw, Crop, FlipHorizontal,
  FlipVertical, Undo2, Redo2, RefreshCcw, Check, Image as ImageIcon,
  Sparkles, X, Maximize2
} from "lucide-react";

const MAX_BYTES = 250 * 1024;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function App() {
  const inputRef = useRef(null);
  const canvasRef = useRef(null);

  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [image, setImage] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [crop, setCrop] = useState(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropStart, setCropStart] = useState(null);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");

  const isImage = (f) => f && f.type.startsWith("image/") &&
    ["image/jpeg","image/png","image/webp"].includes(f.type);

  const snapshot = () => ({
    rotation, flipX, flipY, crop: crop ? {...crop} : null
  });

  const applyState = (s) => {
    setRotation(s.rotation);
    setFlipX(s.flipX);
    setFlipY(s.flipY);
    setCrop(s.crop ? {...s.crop} : null);
  };

  const pushHistory = () => {
    setHistory(h => [...h.slice(-19), snapshot()]);
    setFuture([]);
  };

  const resetEditor = () => {
    pushHistory();
    setRotation(0); setFlipX(false); setFlipY(false); setCrop(null);
  };

  const rotate = (delta) => {
    pushHistory();
    setRotation(r => (r + delta + 360) % 360);
    if (cropMode) {
      setCrop(null);
      setCropMode(false);
      setCropStart(null);
    }
  };

  const flip = (axis) => {
    pushHistory();
    axis === "x" ? setFlipX(v => !v) : setFlipY(v => !v);
    if (cropMode) {
      setCrop(null);
      setCropMode(false);
      setCropStart(null);
    }
  };

  const undo = () => {
    if (!history.length) return;
    const current = snapshot();
    const prev = history[history.length - 1];
    setFuture(f => [current, ...f].slice(0,20));
    setHistory(h => h.slice(0,-1));
    applyState(prev);
  };

  const redo = () => {
    if (!future.length) return;
    const current = snapshot();
    const next = future[0];
    setHistory(h => [...h, current].slice(-20));
    setFuture(f => f.slice(1));
    applyState(next);
  };

  const loadFile = (f) => {
    if (!isImage(f)) {
      setMessage("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    setMessage("");
    setFile(f);
    setResult(null);
    setHistory([]);
    setFuture([]);
    setRotation(0); setFlipX(false); setFlipY(false); setCrop(null);
    const url = URL.createObjectURL(f);
    setSourceUrl(url);
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = url;
  };

  const drawPreview = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const rad = rotation * Math.PI / 180;
    const swap = rotation % 180 !== 0;
    const max = 900;
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));

    const fullW = swap ? h : w;
    const fullH = swap ? w : h;

    if (cropMode || !crop) {
      canvas.width = fullW;
      canvas.height = fullH;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, fullW, fullH);
      ctx.save();
      ctx.translate(fullW / 2, fullH / 2);
      ctx.rotate(rad);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(image, -w / 2, -h / 2, w, h);
      ctx.restore();

      if (cropMode && crop) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.52)";
        ctx.fillRect(0, 0, fullW, fullH);
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(crop.x, crop.y, crop.w, crop.h);
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(2, fullW / 500);
        ctx.setLineDash([7, 5]);
        ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
        ctx.restore();
      }
      return;
    }

    // After Apply Crop, actually display only the selected area.
    const cropW = Math.max(1, Math.round(crop.w));
    const cropH = Math.max(1, Math.round(crop.h));

    canvas.width = cropW;
    canvas.height = cropH;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, cropW, cropH);
    ctx.save();
    ctx.translate(-crop.x, -crop.y);
    ctx.translate(fullW / 2, fullH / 2);
    ctx.rotate(rad);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    ctx.restore();
  };

  useEffect(drawPreview, [image, rotation, flipX, flipY, crop, cropMode]);

  // Crop coordinates are stored in the canvas's REAL pixel coordinate system,
  // not its CSS/display size. This prevents the crop box from becoming tiny
  // or covering only part of the image when the canvas is visually scaled.
  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: clamp((e.clientX - rect.left) * scaleX, 0, canvas.width),
      y: clamp((e.clientY - rect.top) * scaleY, 0, canvas.height)
    };
  };

  const beginCrop = (e) => {
    if (!cropMode || !canvasRef.current || !crop) return;

    const handle = getCropHandle(e);
    if (!handle) return;

    canvasRef.current.setPointerCapture?.(e.pointerId);
    const point = getCanvasPoint(e);

    setCropStart({
      x: point.x,
      y: point.y,
      crop: { ...crop },
      handle
    });
  };

  const getCropHandle = (e) => {
    if (!crop || !canvasRef.current) return null;

    const p = getCanvasPoint(e);
    const threshold = Math.max(
      18,
      Math.min(canvasRef.current.width, canvasRef.current.height) * 0.035
    );

    const left = Math.abs(p.x - crop.x) <= threshold;
    const right = Math.abs(p.x - (crop.x + crop.w)) <= threshold;
    const top = Math.abs(p.y - crop.y) <= threshold;
    const bottom = Math.abs(p.y - (crop.y + crop.h)) <= threshold;

    if (left && top) return "nw";
    if (right && top) return "ne";
    if (left && bottom) return "sw";
    if (right && bottom) return "se";
    if (left) return "left";
    if (right) return "right";
    if (top) return "top";
    if (bottom) return "bottom";

    return null;
  };

  const moveCrop = (e) => {
    if (!cropMode || !cropStart || !canvasRef.current) return;

    const point = getCanvasPoint(e);
    const original = cropStart.crop;
    const dx = point.x - cropStart.x;
    const dy = point.y - cropStart.y;
    const minSize = 30;

    let left = original.x;
    let right = original.x + original.w;
    let top = original.y;
    let bottom = original.y + original.h;

    const handle = cropStart.handle;

    if (handle.includes("w") || handle === "left") {
      left = clamp(original.x + dx, 0, right - minSize);
    }

    if (handle.includes("e") || handle === "right") {
      right = clamp(
        original.x + original.w + dx,
        left + minSize,
        canvasRef.current.width
      );
    }

    if (handle.includes("n") || handle === "top") {
      top = clamp(original.y + dy, 0, bottom - minSize);
    }

    if (handle.includes("s") || handle === "bottom") {
      bottom = clamp(
        original.y + original.h + dy,
        top + minSize,
        canvasRef.current.height
      );
    }

    setCrop({
      x: left,
      y: top,
      w: right - left,
      h: bottom - top
    });
  };

  const endCrop = (e) => {
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
    setCropStart(null);
  };

  const performCrop = () => {
    if (!crop || crop.w < 30 || crop.h < 30) {
      setMessage("Adjust the crop edges first.");
      return;
    }

    pushHistory();
    setCropMode(false);
    setCropStart(null);
    setMessage("");
  };

  const cancelCrop = () => {
    setCrop(null);
    setCropMode(false);
    setCropStart(null);
    setMessage("");
  };

  async function renderEditedBlob() {
    const out = document.createElement("canvas");
    const rad = rotation * Math.PI / 180;
    const swap = rotation % 180 !== 0;

    const maxDim = 2400;
    const sourceScale = Math.min(1, maxDim / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * sourceScale));
    const h = Math.max(1, Math.round(image.height * sourceScale));

    let W = swap ? h : w;
    let H = swap ? w : h;

    let cropBox = crop;

    // IMPORTANT: crop coordinates are stored against the FULL preview image.
    // After Apply Crop, the canvas itself is resized to the cropped area,
    // so using canvas.width/canvas.height here would scale the crop twice.
    const previewMax = 900;
    const previewScale = Math.min(
      1,
      previewMax / Math.max(image.width, image.height)
    );
    const previewW0 = Math.max(1, Math.round(image.width * previewScale));
    const previewH0 = Math.max(1, Math.round(image.height * previewScale));
    const previewFullW = swap ? previewH0 : previewW0;
    const previewFullH = swap ? previewW0 : previewH0;

    if (cropBox && cropBox.w > 10 && cropBox.h > 10) {
      const sx = W / previewFullW;
      const sy = H / previewFullH;

      cropBox = {
        x: cropBox.x * sx,
        y: cropBox.y * sy,
        w: cropBox.w * sx,
        h: cropBox.h * sy
      };
    }

    out.width = cropBox ? Math.max(1, Math.round(cropBox.w)) : W;
    out.height = cropBox ? Math.max(1, Math.round(cropBox.h)) : H;

    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.save();

    if (cropBox) {
      ctx.beginPath();
      ctx.rect(0, 0, out.width, out.height);
      ctx.clip();
      ctx.translate(-cropBox.x, -cropBox.y);
    }

    ctx.translate(W / 2, H / 2);
    ctx.rotate(rad);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    ctx.restore();

    return new Promise(resolve => {
      const type =
        file.type === "image/png" ? "image/png" :
        file.type === "image/webp" ? "image/webp" :
        "image/jpeg";

      // Keep transparency for PNG.
      if (type === "image/png") {
        out.toBlob(resolve, type);
      } else {
        out.toBlob(resolve, type, 0.92);
      }
    });
  }

  // Exact target: 250 KiB = 250 * 1024 bytes = 256,000 bytes.
  const TARGET_BYTES = 250 * 1024;

  const blobToArrayBuffer = (blob) => blob.arrayBuffer();

  // PNG allows ancillary chunks. We can safely add a private ancillary
  // chunk to reach exactly TARGET_BYTES without changing the rendered image.
  const makePngExactlyTargetSize = async (blob) => {
    const bytes = new Uint8Array(await blobToArrayBuffer(blob));

    if (bytes.length > TARGET_BYTES) return null;
    if (bytes.length === TARGET_BYTES) return new Blob([bytes], { type: "image/png" });

    const extra = TARGET_BYTES - bytes.length;

    // A PNG ancillary chunk has:
    // 4 bytes length + 4 bytes type + data + 4 bytes CRC.
    // Use one or more tEXt chunks. Maximum chunk payload is 2^31-1,
    // far beyond what we need here.
    const chunks = [];

    // Need at least 12 bytes for a complete PNG chunk.
    if (extra < 12) {
      // Add a small valid tEXt chunk and then adjust using multiple chunks.
      // For exact byte sizing, construct one chunk with a payload that fits.
      return await padPngWithIdat(blob, TARGET_BYTES);
    }

    const payloadLength = extra - 12;
    const chunk = new Uint8Array(extra);
    const view = new DataView(chunk.buffer);

    view.setUint32(0, payloadLength);
    // "tEXt"
    chunk.set([0x74, 0x45, 0x58, 0x74], 4);

    // Keyword "PixLite" followed by NUL, then padding text.
    const keyword = new TextEncoder().encode("PixLite");
    const payload = chunk.subarray(8, 8 + payloadLength);
    payload.fill(0);
    payload.set(keyword.subarray(0, Math.min(keyword.length, payloadLength)), 0);

    // CRC covers type + payload.
    const crc = crc32(chunk.subarray(4, 8 + payloadLength));
    view.setUint32(8 + payloadLength, crc);

    // Insert before IEND.
    const iendOffset = findPngIend(bytes);
    const output = new Uint8Array(TARGET_BYTES);
    output.set(bytes.subarray(0, iendOffset), 0);
    output.set(chunk, iendOffset);
    output.set(bytes.subarray(iendOffset), iendOffset + chunk.length);

    return new Blob([output], { type: "image/png" });
  };

  const findPngIend = (bytes) => {
    // Search for the IEND chunk type.
    for (let i = bytes.length - 12; i >= 8; i--) {
      if (
        bytes[i] === 0x49 &&
        bytes[i + 1] === 0x45 &&
        bytes[i + 2] === 0x4e &&
        bytes[i + 3] === 0x44
      ) {
        return i - 4;
      }
    }
    return bytes.length;
  };

  const padPngWithIdat = async (blob, target) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const needed = target - bytes.length;

    if (needed === 0) return new Blob([bytes], { type: "image/png" });
    if (needed < 12) {
      // Recompress slightly so we have enough room for a valid ancillary chunk.
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.floor(bmp.width * 0.99));
      c.height = Math.max(1, Math.floor(bmp.height * 0.99));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const smaller = await new Promise(resolve => c.toBlob(resolve, "image/png"));
      return makePngExactlyTargetSize(smaller);
    }

    const payloadLength = needed - 12;
    const chunk = new Uint8Array(needed);
    const view = new DataView(chunk.buffer);

    view.setUint32(0, payloadLength);
    chunk.set([0x74, 0x45, 0x58, 0x74], 4); // tEXt
    const payload = chunk.subarray(8, 8 + payloadLength);
    payload.fill(0);
    const keyword = new TextEncoder().encode("PixLite");
    payload.set(keyword.subarray(0, Math.min(keyword.length, payload.length)), 0);

    view.setUint32(8 + payloadLength, crc32(chunk.subarray(4, 8 + payloadLength)));

    const iendOffset = findPngIend(bytes);
    const output = new Uint8Array(target);
    output.set(bytes.subarray(0, iendOffset), 0);
    output.set(chunk, iendOffset);
    output.set(bytes.subarray(iendOffset), iendOffset + chunk.length);

    return new Blob([output], { type: "image/png" });
  };

  const crc32 = (data) => {
    let crc = 0xffffffff;

    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];

      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }

    return (crc ^ 0xffffffff) >>> 0;
  };

  async function compressToExactly250KB(blob) {
    if (file.type === "image/png") {
      // PNG remains PNG. If it is larger than target, reduce dimensions
      // until it fits, then pad it to exactly 256,000 bytes.
      let current = blob;

      if (current.size > TARGET_BYTES) {
        const bmp = await createImageBitmap(current);

        for (let factor = 0.92; factor >= 0.18 && current.size > TARGET_BYTES; factor -= 0.08) {
          const c = document.createElement("canvas");
          c.width = Math.max(40, Math.floor(bmp.width * factor));
          c.height = Math.max(40, Math.floor(bmp.height * factor));

          const ctx = c.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(bmp, 0, 0, c.width, c.height);

          const candidate = await new Promise(resolve =>
            c.toBlob(resolve, "image/png")
          );

          if (candidate && candidate.size < current.size) current = candidate;
          if (candidate && candidate.size <= TARGET_BYTES) break;
        }

        bmp.close();
      }

      if (current.size > TARGET_BYTES) {
        throw new Error("This PNG could not be reduced to 250 KB while preserving PNG format.");
      }

      return makePngExactlyTargetSize(current);
    }

    // JPEG/WEBP: use binary search over quality and dimensions, then
    // fine-tune quality until the result is as close to exactly 256,000 bytes
    // as possible.
    const type = file.type === "image/webp" ? "image/webp" : "image/jpeg";
    let current = blob;

    if (current.size === TARGET_BYTES) return current;

    let bitmap = await createImageBitmap(current);
    let width = bitmap.width;
    let height = bitmap.height;

    // First find a dimension/quality combination below the target.
    let bestUnder = null;

    for (let scale = 1; scale >= 0.18; scale *= 0.86) {
      const w = Math.max(40, Math.round(width * scale));
      const h = Math.max(40, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);

      let low = 0.01;
      let high = 0.98;
      let localBest = null;

      for (let i = 0; i < 10; i++) {
        const q = (low + high) / 2;
        const candidate = await new Promise(resolve =>
          canvas.toBlob(resolve, type, q)
        );

        if (!candidate) continue;

        if (candidate.size <= TARGET_BYTES) {
          localBest = candidate;
          low = q;
        } else {
          high = q;
        }
      }

      if (localBest) {
        if (!bestUnder || localBest.size > bestUnder.size) {
          bestUnder = localBest;
        }
        if (localBest.size >= TARGET_BYTES * 0.995) break;
      }
    }

    bitmap.close();

    if (!bestUnder) {
      throw new Error("The image could not be compressed to 250 KB in its original format.");
    }

    // Exact byte size is not guaranteed by the browser encoder. For JPEG/WEBP
    // we therefore use a lossless trailing padding chunk only where the
    // container format supports it. JPEG supports arbitrary bytes after EOI,
    // so padding is safe. WEBP needs a valid RIFF container and is handled below.
    if (type === "image/jpeg") {
      return padJpegExactly(bestUnder, TARGET_BYTES);
    }

    // WEBP is RIFF based. Rebuild the RIFF size field and add a JUNK chunk.
    if (type === "image/webp") {
      return padWebpExactly(bestUnder, TARGET_BYTES);
    }

    return bestUnder;
  }

  const padJpegExactly = async (blob, target) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());

    if (bytes.length === target) {
      return new Blob([bytes], { type: "image/jpeg" });
    }

    if (bytes.length > target) {
      throw new Error("JPEG is already larger than the exact target.");
    }

    // Put valid JPEG COM metadata segments in the header, BEFORE the
    // Start Of Scan marker. This keeps the JPEG decodable.
    const sos = findJpegSos(bytes);
    if (sos < 0) {
      throw new Error("Could not locate the JPEG image data.");
    }

    let remaining = target - bytes.length;
    if (remaining < 4) {
      throw new Error("JPEG is too close to 250 KB to pad safely.");
    }

    const segments = [];

    while (remaining > 0) {
      // Total segment bytes = 4 + payload.
      // JPEG's 2-byte length field counts itself + payload.
      const payloadLength = Math.min(65533, remaining - 4);
      const segmentSize = payloadLength + 4;

      const segment = new Uint8Array(segmentSize);
      segment[0] = 0xFF;
      segment[1] = 0xFE;

      const jpegLength = payloadLength + 2;
      segment[2] = (jpegLength >> 8) & 0xFF;
      segment[3] = jpegLength & 0xFF;

      // Harmless printable comment bytes.
      segment.fill(0x20, 4);

      segments.push(segment);
      remaining -= segmentSize;
    }

    const paddingSize = segments.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(bytes.length + paddingSize);

    output.set(bytes.subarray(0, sos), 0);

    let offset = sos;
    for (const segment of segments) {
      output.set(segment, offset);
      offset += segment.length;
    }

    output.set(bytes.subarray(sos), offset);

    if (output.length !== target) {
      throw new Error("Could not create an exact 250 KB JPEG.");
    }

    return new Blob([output], { type: "image/jpeg" });
  };

  const findJpegSos = (bytes) => {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      return -1;
    }

    let i = 2;

    while (i < bytes.length - 1) {
      if (bytes[i] !== 0xFF) {
        i++;
        continue;
      }

      while (i < bytes.length && bytes[i] === 0xFF) i++;
      if (i >= bytes.length) return -1;

      const marker = bytes[i];
      const markerStart = i - 1;

      if (marker === 0xDA) return markerStart;

      if (
        marker === 0xD8 ||
        marker === 0xD9 ||
        (marker >= 0xD0 && marker <= 0xD7) ||
        marker === 0x01
      ) {
        i++;
        continue;
      }

      if (i + 2 >= bytes.length) return -1;

      const length = (bytes[i + 1] << 8) | bytes[i + 2];
      if (length < 2 || i + 1 + length >= bytes.length) return -1;

      // i points at marker byte; length starts at i+1.
      i += 1 + length;
    }

    return -1;
  };

  const padWebpExactly = async (blob, target) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());

    if (bytes.length === target) return new Blob([bytes], { type: "image/webp" });
    if (bytes.length > target) return null;

    let extra = target - bytes.length;

    // A RIFF JUNK chunk needs 8 bytes header plus payload.
    // Make sure payload is even because RIFF chunks are word-aligned.
    if (extra < 8) {
      throw new Error("Could not exactly size this WEBP image.");
    }

    const payloadLength = extra - 8;
    const paddedPayload = payloadLength % 2 === 0 ? payloadLength : payloadLength - 1;
    const chunkLength = 8 + paddedPayload;

    const output = new Uint8Array(bytes.length + chunkLength);
    output.set(bytes, 0);

    const view = new DataView(output.buffer);
    const offset = bytes.length;

    // JUNK chunk
    output.set([0x4a, 0x55, 0x4e, 0x4b], offset);
    view.setUint32(offset + 4, paddedPayload, true);

    // Update RIFF file size: total file size - 8.
    view.setUint32(4, output.length - 8, true);

    return new Blob([output], { type: "image/webp" });
  };

  const processImage = async () => {
    if (!file || !image) return;

    setProcessing(true);
    setResult(null);
    setMessage("");

    try {
      const edited = await renderEditedBlob();
      const finalBlob = await compressToExactly250KB(edited);

      if (!finalBlob || finalBlob.size !== TARGET_BYTES) {
        throw new Error("The final image was not exactly 250 KB. Please try again.");
      }

      const url = URL.createObjectURL(finalBlob);

      setResult({
        blob: finalBlob,
        url,
        size: finalBlob.size,
        name:
          file.name.replace(/\.[^.]+$/, "") +
          "_250kb" +
          file.name.slice(file.name.lastIndexOf("."))
      });
    } catch (e) {
      setMessage(
        e.message ||
        "Something went wrong while creating the exact 250 KB image."
      );
    } finally {
      setProcessing(false);
    }
  };

  const startCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    pushHistory();
    setCrop({
      x: 0,
      y: 0,
      w: canvas.width,
      h: canvas.height
    });
    setCropMode(true);
    setCropStart(null);
    setMessage("");
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openFile = () => inputRef.current?.click();

  const originalSize = useMemo(() => file ? formatBytes(file.size) : "", [file]);
  const finalSize = useMemo(() => result ? formatBytes(result.size) : "", [result]);

  return (
    <div className="app">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) loadFile(selected);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <div className="brand">
          <div className="brandMark"><Sparkles size={17}/></div>
          <span>PixLite</span>
        </div>
        <div className="topHint">Simple image tools</div>
      </header>

      {!file ? (
        <main className="landing">
          <div className="eyebrow">IMAGE TOOLKIT</div>
          <h1>Make your images<br/><span>light & ready.</span></h1>
          <p className="subtitle">
            Edit any image and automatically make the final file exactly 250KB.
          </p>

          <div
            className={`drop ${dragging ? "dragging" : ""}`}
            onClick={openFile}
            onDragOver={(e)=>{e.preventDefault();setDragging(true)}}
            onDragLeave={()=>setDragging(false)}
            onDrop={(e)=>{e.preventDefault();setDragging(false);loadFile(e.dataTransfer.files[0])}}
          >
            <div className="uploadCircle"><Upload size={25}/></div>
            <h2>Drop an image here</h2>
            <p>or click to choose a file</p>
            <div className="formats">JPG · PNG · WEBP</div>
          </div>

          <div className="privacy"><Check size={14}/> Processed locally in your browser</div>
          {message && <div className="error">{message}</div>}
        </main>
      ) : (
        <main className="workspace">
          <div className="workspaceHead">
            <div>
              <div className="eyebrow">EDITOR</div>
              <h1>Edit your image</h1>
              <p>{file.name} · {originalSize}</p>
            </div>
            <button className="iconBtn" onClick={()=>{setFile(null);setImage(null);setResult(null)}} title="Close">
              <X size={20}/>
            </button>
          </div>

          <section className="editorCard">
            <div className="canvasArea">
              <canvas
                ref={canvasRef}
                onPointerDown={beginCrop}
                onPointerMove={moveCrop}
                onPointerUp={endCrop}
                onPointerLeave={endCrop}
                className={cropMode ? "cropCursor" : ""}
              />
              {cropMode && crop && (
                <>
                  <div
                    className="cropEdge cropEdgeTop"
                    style={{ left: `${(crop.x / canvasRef.current.width) * 100}%`, width: `${(crop.w / canvasRef.current.width) * 100}%`, top: `${(crop.y / canvasRef.current.height) * 100}%` }}
                  />
                  <div
                    className="cropEdge cropEdgeBottom"
                    style={{ left: `${(crop.x / canvasRef.current.width) * 100}%`, width: `${(crop.w / canvasRef.current.width) * 100}%`, top: `${((crop.y + crop.h) / canvasRef.current.height) * 100}%` }}
                  />
                  <div
                    className="cropEdge cropEdgeLeft"
                    style={{ left: `${(crop.x / canvasRef.current.width) * 100}%`, top: `${(crop.y / canvasRef.current.height) * 100}%`, height: `${(crop.h / canvasRef.current.height) * 100}%` }}
                  />
                  <div
                    className="cropEdge cropEdgeRight"
                    style={{ left: `${((crop.x + crop.w) / canvasRef.current.width) * 100}%`, top: `${(crop.y / canvasRef.current.height) * 100}%`, height: `${(crop.h / canvasRef.current.height) * 100}%` }}
                  />
                  {[
                    ["nw", crop.x, crop.y],
                    ["ne", crop.x + crop.w, crop.y],
                    ["sw", crop.x, crop.y + crop.h],
                    ["se", crop.x + crop.w, crop.y + crop.h]
                  ].map(([name, x, y]) => (
                    <div
                      key={name}
                      className={`cropCorner ${name}`}
                      style={{
                        left: `${(x / canvasRef.current.width) * 100}%`,
                        top: `${(y / canvasRef.current.height) * 100}%`
                      }}
                    />
                  ))}
                  <div className="cropActions">
                    <button className="cropApply" onClick={performCrop}>Apply Crop</button>
                    <button className="cropCancel" onClick={cancelCrop}>Cancel</button>
                  </div>
                  <div className="cropHint">Drag the sides or corners inward to crop</div>
                </>
              )}
            </div>

            <div className="toolbar">
              <ToolButton icon={<RotateCcw/>} text="Rotate left" onClick={()=>rotate(-90)}/>
              <ToolButton icon={<RotateCw/>} text="Rotate right" onClick={()=>rotate(90)}/>
              <div className="divider"/>
              <ToolButton icon={<Crop/>} text="Crop" active={cropMode} onClick={startCrop}/>
              <ToolButton icon={<FlipHorizontal/>} text="Flip H" onClick={()=>flip("x")}/>
              <ToolButton icon={<FlipVertical/>} text="Flip V" onClick={()=>flip("y")}/>
              <div className="divider"/>
              <ToolButton icon={<Undo2/>} text="Undo" disabled={!history.length} onClick={undo}/>
              <ToolButton icon={<Redo2/>} text="Redo" disabled={!future.length} onClick={redo}/>
              <ToolButton icon={<RefreshCcw/>} text="Reset" onClick={resetEditor}/>
            </div>

            {cropMode && (
              <div className="cropActions">
                <span>Choose the area you want to keep.</span>
                <div>
                  <button className="secondary" onClick={()=>{setCropMode(false);setCrop(null)}}>Cancel</button>
                  <button className="primary small" onClick={performCrop}>Apply crop</button>
                </div>
              </div>
            )}

            <div className="bottomBar">
              <div className="formatInfo">
                <span className="statusDot"/>
                <div>
                  <strong>{file.type.split("/")[1].toUpperCase()}</strong>
                  <small>Original: {originalSize}</small>
                </div>
              </div>

              {!result ? (
                <button className="primary" disabled={processing || cropMode} onClick={processImage}>
                  {processing ? <><span className="spinner"/> Processing…</> : <><Sparkles size={18}/> Make exactly 250KB</>}
                </button>
              ) : (
                <button className="primary" onClick={download}>
                  <Download size={18}/> Download exactly 250KB
                </button>
              )}
            </div>
          </section>

          {result && (
            <div className="success">
              <div className="successIcon"><Check size={18}/></div>
              <div>
                <strong>Ready to download</strong>
                <span>{finalSize} · same {file.type.split("/")[1].toUpperCase()} format · exactly 250KB</span>
              </div>
            </div>
          )}

          {message && <div className="error">{message}</div>}
        </main>
      )}

      <footer>PixLite · Fast, private image compression</footer>
    </div>
  );
}

function ToolButton({icon,text,onClick,disabled,active}) {
  return <button className={`tool ${active ? "active":""}`} disabled={disabled} onClick={onClick}>
    {React.cloneElement(icon,{size:18,strokeWidth:1.9})}<span>{text}</span>
  </button>
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(2)} MB`;
}

export default App;
