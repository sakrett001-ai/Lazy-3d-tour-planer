// Authored 1 × 0.6 × 0.8 m box for importer and end-to-end tests, no external asset.
export function boxGLB(change = () => {}) {
  const xyz = [
    0, 0, 0, 1, 0, 0, 1, 0.8, 0, 0, 0.8, 0, 0, 0, 0.6, 1, 0, 0.6, 1, 0.8, 0.6, 0, 0.8, 0.6,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 1, 2, 6, 1, 6, 5, 0, 4,
    7, 0, 7, 3,
  ];
  const positions = Buffer.from(new Float32Array(xyz).buffer),
    faces = Buffer.from(new Uint16Array(indices).buffer),
    uv = Buffer.from(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]).buffer),
    bin = Buffer.concat([positions, faces, uv]);
  const data = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.45, 0.6, 0.45, 1],
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: faces.length },
      { buffer: 0, byteOffset: positions.length + faces.length, byteLength: uv.length },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 0.8, 0.6],
      },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 8, type: 'VEC2' },
    ],
  };
  change(data);
  const raw = Buffer.from(JSON.stringify(data)),
    json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)]),
    header = Buffer.alloc(12),
    jh = Buffer.alloc(8),
    bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + bin.length, 8);
  jh.writeUInt32LE(json.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, json, bh, bin]);
}
export function texturedBoxGLB() {
  return boxGLB((j) => {
    j.images = [
      {
        uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4AWL6z8DwH4SZGKAAAAAA//8qMqaOAAAABklEQVQDADYSBAFv606fAAAAAElFTkSuQmCC',
      },
    ];
    j.textures = [{ source: 0 }];
    j.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  });
}
