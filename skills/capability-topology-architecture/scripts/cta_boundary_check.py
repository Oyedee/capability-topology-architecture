#!/usr/bin/env python3
"""Heuristic static check for Capability Topology Architecture rules in any codebase.

It is a smoke detector, not a proof: it finds likely violations of rules 2/5 (reaching into
another module), 3 (addresses/transports at call sites), 6 (distributed transactions),
9 (request-borne gate bypass) and plugin-family leaks (rule 10). Review every hit.

Usage:
  python3 cta_boundary_check.py <modules_dir> [--public contract,contracts,api,public]
         [--edge plugins,connectors,infrastructure,adapters,operations] [--json]

Assumes one sub-directory per module under <modules_dir>. Files inside a module's public
directories may be imported by others. Files inside "edge" directories (where the operation
seam is implemented, or connectors live) may legitimately contain URLs and HTTP clients.
"""
import argparse, json, os, re, sys

CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go", ".cs", ".java", ".kt", ".dart", ".rb", ".php", ".rs", ".sql"}
SKIP_DIRS = {"node_modules", ".git", "bin", "obj", "build", "dist", "target", "__pycache__", ".dart_tool", "vendor"}

IMPORT_LINE = re.compile(r"^\s*(import|from|using|require|package|use|#include|export\s+.*from)\b|require\(|import\(", re.I)
TRANSPORT_AT_CALLSITE = [
    (re.compile(r"https?://", re.I), "URL literal in module code"),
    (re.compile(r"\b(fetch|axios|got|ky)\s*[.(]|\bHttpClient\b|\brequests\.(get|post|put|delete)\b|\bhttpx\.|\bhttp\.(Get|Post|NewRequest)\b|\bRestTemplate\b|\bWebClient\b|\bDio\(\)|\bhttp\.(get|post)\(", re.I), "HTTP client used directly"),
    (re.compile(r"\b(grpc\.|NewClient\(|ManagedChannel)\b"), "RPC client constructed directly"),
    (re.compile(r"\b(timeout|retries|maxRetries|retryPolicy)\s*[:=]", re.I), "timeout/retry policy at call site"),
]
DISTRIBUTED_TX = re.compile(r"\bTransactionScope\b|\bXA(Resource|DataSource)\b|\bJtaTransactionManager\b|\btwo[-_ ]?phase\b|\b2pc\b", re.I)
GATE_BYPASS = re.compile(r"\b(skip|bypass|disable)_?(approval|auth|permission|gate|validation)s?\b|x-(skip|bypass)-|\bisAdmin\b\s*[:=]\s*(req|request|body|headers)", re.I)
CROSS_SCHEMA_SQL = re.compile(r"\b(from|join|update|into)\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)", re.I)


def walk(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in files:
            if os.path.splitext(f)[1].lower() in CODE_EXT:
                yield os.path.join(d, f)


def module_patterns(name):
    n = re.escape(name)
    variants = {n, re.escape(name.replace("-", "_")), re.escape(name.replace("_", "-")), re.escape(name.replace("-", "").replace("_", ""))}
    alt = "|".join(sorted(variants))
    # matches modules/<name>/<rest>  or  modules.<name>.<rest>  or  @scope/<name>/<rest>
    return re.compile(rf"(?:modules?[/.\\]|@[\w-]+/|\.\./)(?:{alt})(?:[/.\\]([\w.\-/\\]+))?", re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modules_dir")
    ap.add_argument("--public", default="contract,contracts,api,public")
    ap.add_argument("--edge", default="plugins,connectors,infrastructure,adapters,operations,impl,store,persistence")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(a.modules_dir)
    if not os.path.isdir(root):
        sys.exit(f"Not a directory: {root}")
    modules = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)) and d not in SKIP_DIRS)
    public = {p.strip().lower() for p in a.public.split(",") if p.strip()}
    edge = {p.strip().lower() for p in a.edge.split(",") if p.strip()}
    pats = {m: module_patterns(m) for m in modules}
    norm = lambda s: re.sub(r"[-_]", "", s.lower())
    module_keys = {norm(m) for m in modules}

    findings = []
    def add(rule, sev, path, ln, msg, text):
        findings.append({"rule": rule, "severity": sev, "file": os.path.relpath(path, root), "line": ln, "issue": msg, "code": text.strip()[:160]})

    for m in modules:
        mroot = os.path.join(root, m)
        for path in walk(mroot):
            rel_parts = [p.lower() for p in os.path.relpath(path, mroot).split(os.sep)[:-1]]
            in_edge = any(p in edge for p in rel_parts)
            try:
                lines = open(path, encoding="utf-8", errors="ignore").read().splitlines()
            except OSError:
                continue
            for i, line in enumerate(lines, 1):
                s = line.strip()
                if not s or s.startswith(("//", "#", "*", "--")) and not IMPORT_LINE.search(s):
                    continue
                if IMPORT_LINE.search(line):
                    for other, pat in pats.items():
                        if other == m:
                            continue
                        for mt in pat.finditer(line):
                            rest = (mt.group(1) or "").replace("\\", "/").replace(".", "/").lower()
                            first = rest.split("/")[0] if rest else ""
                            if first and first not in public:
                                add("2", "High", path, i, f"imports internals of module '{other}' (not via {sorted(public)})", line)
                if not in_edge:
                    for rx, msg in TRANSPORT_AT_CALLSITE:
                        if rx.search(line):
                            add("3", "Medium", path, i, msg + " outside an edge/operation directory", line)
                            break
                if DISTRIBUTED_TX.search(line):
                    add("6", "High", path, i, "distributed/ambient transaction primitive", line)
                if GATE_BYPASS.search(line):
                    add("9", "High", path, i, "possible request-borne gate bypass flag", line)
                for mt in CROSS_SCHEMA_SQL.finditer(line):
                    schema = norm(mt.group(2))
                    if schema in module_keys and schema != norm(m):
                        add("5", "High", path, i, f"SQL touches another module's schema '{mt.group(2)}'", line)

    # Rule 10 heuristic: module code (outside edge dirs) naming a connector directory name
    conn_root = None
    for cand in ("connectors", "plugins"):
        p = os.path.join(os.path.dirname(root), cand)
        if os.path.isdir(p):
            conn_root = p
    if conn_root:
        names = [d for d in os.listdir(conn_root) if os.path.isdir(os.path.join(conn_root, d))]
        if names:
            rx = re.compile(r"[\"'](" + "|".join(re.escape(n) for n in names) + r")[\"']", re.I)
            for m in modules:
                for path in walk(os.path.join(root, m)):
                    for i, line in enumerate(open(path, encoding="utf-8", errors="ignore"), 1):
                        if rx.search(line):
                            add("10", "Medium", path, i, "module names a specific connector/plugin", line)

    if a.json:
        print(json.dumps({"modules": modules, "findings": findings}, indent=2))
    else:
        print(f"# CTA boundary scan — {len(modules)} modules: {', '.join(modules) or '(none)'}\n")
        if not findings:
            print("No heuristic findings. Still walk the 15 rules by hand (pipeline order, idempotency, outbox, reconciliation are invisible to this scan).")
        else:
            print("| Rule | Sev | Location | Issue | Code |\n|---|---|---|---|---|")
            for f in findings:
                code = f["code"].replace("|", "\\|")
                print(f"| {f['rule']} | {f['severity']} | {f['file']}:{f['line']} | {f['issue']} | `{code}` |")
            print(f"\n{len(findings)} finding(s). Heuristic — confirm each by reading the code.")
    sys.exit(1 if any(f["severity"] == "High" for f in findings) else 0)


if __name__ == "__main__":
    main()
