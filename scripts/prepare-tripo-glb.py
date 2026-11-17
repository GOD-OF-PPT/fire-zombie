"""Resize embedded prop textures without changing geometry or adding a decoder dependency.

Run after glTF Transform center/optimize (with texture compression disabled).
Requires Pillow; source GLB remains unchanged.
"""
import argparse
import io
import json
from pathlib import Path
import struct

from PIL import Image


def prepare(source: Path, destination: Path, limit: int) -> None:
    raw = source.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    if magic != 0x46546C67 or version != 2 or length != len(raw):
        raise ValueError('Expected a complete glTF 2.0 binary')
    json_length, json_type = struct.unpack_from('<II', raw, 12)
    if json_type != 0x4E4F534A:
        raise ValueError('Missing GLB JSON chunk')
    doc = json.loads(raw[20:20 + json_length])
    bin_length, bin_type = struct.unpack_from('<II', raw, 20 + json_length)
    if bin_type != 0x004E4942:
        raise ValueError('Missing GLB binary chunk')
    binary = raw[28 + json_length:28 + json_length + bin_length]
    replacements = {}
    texture_report = []
    base_sources = {
        doc['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
        for m in doc.get('materials', [])
        if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})
    }
    for index, image in enumerate(doc.get('images', [])):
        view_index = image['bufferView']
        view = doc['bufferViews'][view_index]
        start = view.get('byteOffset', 0)
        with Image.open(io.BytesIO(binary[start:start + view['byteLength']])) as opened:
            before = opened.size
            resized = opened.convert('RGB')
            resized.thumbnail((limit, limit), Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            if index in base_sources:
                resized.save(encoded, format='JPEG', quality=90, subsampling=0, optimize=True)
                image['mimeType'] = 'image/jpeg'
            else:
                # Preserve linear-channel ORM and normal data without a second JPEG encoding.
                resized.save(encoded, format='PNG', optimize=True)
                image['mimeType'] = 'image/png'
            replacements[view_index] = encoded.getvalue()
            texture_report.append({'name': image.get('name', str(index)), 'before': before, 'after': resized.size})

    packed = bytearray()
    for index, view in enumerate(doc['bufferViews']):
        start = view.get('byteOffset', 0)
        data = replacements.get(index, binary[start:start + view['byteLength']])
        packed.extend(b'\0' * (-len(packed) % 4))
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(data)
        packed.extend(data)
    doc['buffers'][0]['byteLength'] = len(packed)
    packed.extend(b'\0' * (-len(packed) % 4))
    encoded_json = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    encoded_json += b' ' * (-len(encoded_json) % 4)
    output = (
        struct.pack('<III', 0x46546C67, 2, 28 + len(encoded_json) + len(packed))
        + struct.pack('<II', len(encoded_json), 0x4E4F534A) + encoded_json
        + struct.pack('<II', len(packed), 0x004E4942) + packed
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)
    print(json.dumps({'sourceBytes': len(raw), 'runtimeBytes': len(output), 'textures': texture_report}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--max-texture', type=int, default=1024)
    args = parser.parse_args()
    if args.max_texture <= 0:
        parser.error('--max-texture must be positive')
    if args.source.resolve() == args.destination.resolve():
        parser.error('Choose a different destination to preserve the source')
    prepare(args.source, args.destination, args.max_texture)
