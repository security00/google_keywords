#!/usr/bin/env python3
import os
from pathlib import Path

SRC = Path(os.getenv("D1_EXPORT_SRC", "d1_export.sql"))
OUT_DIR = Path(os.getenv("D1_EXPORT_OUT_DIR", "d1_export_parts"))
CHUNK_SIZE = int(os.getenv("D1_EXPORT_CHUNK_SIZE", "1000"))


def split_statements(sql_text: str):
    statements = []
    current = []
    in_string = False
    i = 0
    while i < len(sql_text):
        ch = sql_text[i]
        if ch == "'":
            if in_string and i + 1 < len(sql_text) and sql_text[i + 1] == "'":
                current.append("''")
                i += 2
                continue
            in_string = not in_string
        if ch == ";" and not in_string:
            stmt = "".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    trailing = "".join(current).strip()
    if trailing:
        statements.append(trailing)
    return statements


def write_statements(path: Path, statements):
    if not statements:
        return
    content = ";\n".join(statements) + ";\n"
    path.write_text(content, encoding="utf-8")


def main():
    if not SRC.exists():
        raise SystemExit(f"missing {SRC}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = SRC.read_text(encoding="utf-8")
    statements = split_statements(raw)

    schema = []
    indexes = []
    inserts = []
    misc = []

    for stmt in statements:
        lowered = stmt.strip().lower()
        if not lowered:
            continue
        if lowered.startswith("pragma "):
            continue
        if lowered.startswith("begin") or lowered.startswith("commit"):
            continue
        if lowered.startswith("create table"):
            schema.append(stmt)
            continue
        if lowered.startswith("create index"):
            indexes.append(stmt)
            continue
        if lowered.startswith("insert into"):
            inserts.append(stmt)
            continue
        misc.append(stmt)

    schema_path = OUT_DIR / "schema.sql"
    write_statements(schema_path, schema + misc)

    data_paths = []
    for i in range(0, len(inserts), CHUNK_SIZE):
        chunk = inserts[i : i + CHUNK_SIZE]
        out = OUT_DIR / f"data_{i // CHUNK_SIZE + 1:03d}.sql"
        write_statements(out, chunk)
        data_paths.append(out)

    index_path = OUT_DIR / "indexes.sql"
    index_statements = list(indexes)
    index_statements.append("PRAGMA optimize")
    write_statements(index_path, index_statements)

    print(f"schema: {schema_path}")
    print(f"data_files: {len(data_paths)}")
    print(f"indexes: {index_path}")


if __name__ == "__main__":
    main()
