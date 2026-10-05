import argparse
import hashlib
import json
import os
import time

import numpy as np
import sentence_transformers
import torch
from sentence_transformers import SentenceTransformer

MODEL = "BAAI/bge-small-en-v1.5"
REVISION = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"
CHUNK = 65536


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--max-length", type=int, default=512)
    options = parser.parse_args()

    os.makedirs(options.out, exist_ok=True)
    model = SentenceTransformer(MODEL, revision=REVISION, device="cuda")
    model.half()
    model.max_seq_length = options.max_length
    digest, size, count, started = hashlib.sha256(), 0, 0, time.time()
    path = lambda name: os.path.join(options.out, name)

    with open(options.corpus, "rb") as corpus, open(path("vectors.i8"), "wb") as vectors, open(path("scales.f32"), "wb") as scales, open(path("ids.txt"), "w") as ids:
        texts = []

        def flush():
            embeddings = model.encode(texts, batch_size=options.batch, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)
            absmax = np.abs(embeddings).max(axis=1, keepdims=True)
            absmax[absmax == 0] = 1
            vectors.write(np.rint(embeddings / absmax * 127).astype(np.int8).tobytes())
            scales.write((absmax[:, 0] / 127).astype("<f4").tobytes())
            texts.clear()
            print(f"{count:,} documents, {time.time() - started:.0f} s", flush=True)

        for line in corpus:
            digest.update(line)
            size += len(line)
            if not line.strip():
                continue
            document = json.loads(line)
            ids.write(document["doc_id"] + "\n")
            texts.append(f"{document['title']} {document['body']}".strip())
            count += 1
            if len(texts) == CHUNK:
                flush()
        if texts:
            flush()

    meta = {
        "model": MODEL,
        "revision": REVISION,
        "dimensions": model.get_sentence_embedding_dimension(),
        "documents": count,
        "quantization": "int8, per-vector absmax / 127, scale in scales.f32",
        "max_length": options.max_length,
        "precision": "fp16",
        "corpus": {"path": options.corpus, "sha256": digest.hexdigest(), "bytes": size},
        "seconds": time.time() - started,
        "gpu": torch.cuda.get_device_name(0),
        "torch": torch.__version__,
        "sentence_transformers": sentence_transformers.__version__,
    }
    with open(path("dense.json"), "w") as file:
        json.dump(meta, file, indent=2)
        file.write("\n")


if __name__ == "__main__":
    main()
