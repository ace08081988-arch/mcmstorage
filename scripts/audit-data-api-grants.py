#!/usr/bin/env python3
"""Static explicit-ACL inventory. No database connection or credentials are used.

Install scripts/data-api-audit-requirements.txt, then run with --write or --check.
This parses SQL with PostgreSQL's parser. It does not execute PL/pgSQL, RLS,
triggers, or RPCs and must not be described as a successful database reset.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import tempfile

from pglast import parse_sql
from pglast.stream import RawStream

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "docs/qa/data-api-grants-2026-10-23.json"
DML = {"select", "insert", "update", "delete"}
ALL_TABLE = DML | {"truncate", "references", "trigger", "maintain"}
ALL_SEQUENCE = {"usage", "select", "update"}


def name(relation):
    return (relation.get("schemaname") or "public") + "." + relation["relname"]


def role(spec):
    return spec.get("rolename") or "PUBLIC"


def sql(node):
    return RawStream()(node)


def audit(root):
    files = sorted((root / "supabase/migrations").glob("*.sql"))
    objects = {}
    errors = []
    unexecuted_blocks = []
    uncreated_application_references = []
    creates = 0
    for path in files:
        relative = str(path.relative_to(root))
        statements = [raw.stmt for raw in parse_sql(path.read_text())]
        grants_here = {}
        for stmt in statements:
            d = stmt()
            if d["@"] == "GrantStmt" and d["is_grant"] and d["objtype"]["name"] in {"OBJECT_TABLE", "OBJECT_SEQUENCE"}:
                for relation in d["objects"] or ():
                    if relation["@"] == "RangeVar":
                        grants_here.setdefault(name(relation), []).append(sql(stmt))
        for stmt in statements:
            d = stmt()
            kind = d["@"]
            if kind in {"CreateStmt", "ViewStmt"}:
                relation = d["relation"] if kind == "CreateStmt" else d["view"]
                key = name(relation)
                if not key.startswith("public."):
                    continue
                if kind == "CreateStmt":
                    creates += 1
                    if key not in grants_here:
                        errors.append(f"{relative}: {key} lacks an explicit same-migration GRANT")
                obj = objects.setdefault(key, {"kind": "table" if kind == "CreateStmt" else "view", "creates": [], "drops": [], "present": False, "rls_enabled": False, "explicit_privileges": {}, "acl_history": [], "policy_sources": [], "application_operations": []})
                # IF NOT EXISTS retains the object; CREATE after DROP starts a new ACL.
                if not obj["present"]:
                    obj["explicit_privileges"] = {}
                    obj["rls_enabled"] = False
                obj["present"] = True
                obj["creates"].append(relative)
                if kind == "CreateStmt":
                    for col in d["tableElts"] or ():
                        if col["@"] != "ColumnDef":
                            continue
                        types = [item["sval"] for item in col["typeName"]["names"]]
                        if any(t in {"serial", "bigserial", "smallserial", "serial2", "serial4", "serial8"} for t in types):
                            seq = key + "_" + col["colname"] + "_seq"
                            if seq not in grants_here:
                                errors.append(f"{relative}: serial sequence {seq} lacks explicit GRANT")
            elif kind == "GrantStmt" and d["objtype"]["name"] in {"OBJECT_TABLE", "OBJECT_SEQUENCE"}:
                for relation in d["objects"] or ():
                    if relation["@"] != "RangeVar":
                        continue
                    key = name(relation)
                    obj = objects.setdefault(key, {"kind": "sequence" if d["objtype"]["name"] == "OBJECT_SEQUENCE" else "uncreated_relation", "creates": [], "drops": [], "present": True, "rls_enabled": False, "explicit_privileges": {}, "acl_history": [], "policy_sources": [], "application_operations": []})
                    text = sql(stmt)
                    obj["acl_history"].append({"migration": relative, "sql": text})
                    all_privs = ALL_SEQUENCE if obj["kind"] == "sequence" else ALL_TABLE
                    privs = d["privileges"] or [{"priv_name": p, "cols": None} for p in sorted(all_privs)]
                    for grantee in d["grantees"] or ():
                        who = role(grantee)
                        current = set(obj["explicit_privileges"].get(who, []))
                        for priv in privs:
                            tokens = [priv["priv_name"]] if not priv["cols"] else [priv["priv_name"] + "(" + item["sval"] + ")" for item in priv["cols"]]
                            if d["is_grant"]:
                                current.update(tokens)
                            else:
                                current.difference_update(tokens)
                                if not priv["cols"]:
                                    current = {p for p in current if not p.startswith(priv["priv_name"] + "(")}
                        obj["explicit_privileges"][who] = sorted(current)
            elif kind == "DropStmt" and d["removeType"]["name"] == "OBJECT_TABLE":
                for relation in d["objects"]:
                    key = ".".join(item["sval"] for item in relation)
                    if "." not in key:
                        key = "public." + key
                    if key in objects:
                        objects[key]["present"] = False
                        objects[key]["rls_enabled"] = False
                        objects[key]["drops"].append(relative)
                        objects[key]["explicit_privileges"] = {}
            elif kind == "AlterTableStmt":
                key = name(d["relation"])
                if key in objects:
                    for cmd in d["cmds"]:
                        sub = cmd["subtype"]["name"]
                        if sub in {"AT_EnableRowSecurity", "AT_DisableRowSecurity"}:
                            objects[key]["rls_enabled"] = sub == "AT_EnableRowSecurity"
            elif kind in {"CreatePolicyStmt", "AlterPolicyStmt"}:
                key = name(d["table"])
                if key in objects:
                    objects[key]["policy_sources"].append({"migration": relative, "sql": sql(stmt)})
            elif kind == "DoStmt":
                # Record migration names for security review, without pretending
                # conditional/dynamic statements have been executed.
                body = stmt.args[0].arg.sval
                if re.search(r"\b(?:policy|grant|revoke)\b", body, re.I):
                    unexecuted_blocks.append(relative)
    for path in sorted((root / "src").rglob("*")):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        text = path.read_text()
        for match in re.finditer(r"\.from\(\s*['\"]([a-z_][a-z0-9_]*)['\"]\s*\)\s*\.(select|insert|upsert|update|delete)\s*\(", text):
            key = "public." + match[1]
            if key in objects:
                evidence = {"file": str(path.relative_to(root)), "operation": match[2]}
                if evidence not in objects[key]["application_operations"]:
                    objects[key]["application_operations"].append(evidence)
            else:
                uncreated_application_references.append({"relation": key, "file": str(path.relative_to(root)), "operation": match[2]})
    for key, obj in objects.items():
        if obj["kind"] == "table" and obj["present"] and not obj["rls_enabled"]:
            errors.append(f"{key}: created public table has no explicit ENABLE ROW LEVEL SECURITY")
    settings = objects.get("public.app_settings", {})
    if "update(worker_portal_config)" not in settings.get("explicit_privileges", {}).get("authenticated", []):
        errors.append("app_settings.worker_portal_config: authenticated column UPDATE contract missing")
    return {"scope": "static SQL declarations and literal application references; not live ACLs or executed PL/pgSQL", "baseline_commit": "a85f27086ed08e7a0cff86560df42d225a9c652c", "migration_count": len(files), "create_table_statements": creates, "unique_created_tables": sum(o["kind"] == "table" for o in objects.values()), "surviving_created_tables": sum(o["kind"] == "table" and o["present"] for o in objects.values()), "security_blocks_requiring_runtime_review": sorted(set(unexecuted_blocks)), "uncreated_application_references": uncreated_application_references, "objects": dict(sorted(objects.items()))}, errors


def self_test():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        migrations = root / "supabase/migrations"
        migrations.mkdir(parents=True)
        (root / "src").mkdir()
        fixture = migrations / "001.sql"
        narrow = "CREATE TABLE public.app_settings(worker_portal_config jsonb); ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public.app_settings TO authenticated; GRANT UPDATE(worker_portal_config) ON public.app_settings TO authenticated;"
        fixture.write_text(narrow)
        assert not audit(root)[1], audit(root)[1]
        fixture.write_text(narrow.replace("GRANT UPDATE(worker_portal_config) ON public.app_settings TO authenticated;", ""))
        assert any("column UPDATE contract" in e for e in audit(root)[1])
        fixture.write_text(narrow + " CREATE TABLE public.internal_only(id uuid); ALTER TABLE public.internal_only ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public.internal_only TO service_role;")
        assert not audit(root)[1], audit(root)[1]
        fixture.write_text(fixture.read_text().replace("GRANT SELECT ON public.internal_only TO service_role;", ""))
        assert any("same-migration GRANT" in e for e in audit(root)[1])
        fixture.write_text(narrow + " CREATE TABLE public.seq_table(id bigserial); ALTER TABLE public.seq_table ENABLE ROW LEVEL SECURITY; GRANT INSERT ON public.seq_table TO service_role;")
        assert any("serial sequence" in e for e in audit(root)[1])
        fixture.write_text(narrow + " CREATE TABLE public.recreated(id uuid); ALTER TABLE public.recreated ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public.recreated TO service_role; DROP TABLE public.recreated; CREATE TABLE public.recreated(id uuid); GRANT SELECT ON public.recreated TO service_role;")
        assert any("public.recreated" in e and "ROW LEVEL SECURITY" in e for e in audit(root)[1])
    print("PASS: mutation tests detect missing column/table/sequence grants and recreated-table RLS; service-only table accepted")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    result, errors = audit(ROOT)
    if errors:
        for error in errors:
            print("FAIL: " + error, file=sys.stderr)
        return 1
    encoded = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.write:
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(encoded)
    if args.check and (not SNAPSHOT.exists() or SNAPSHOT.read_text() != encoded):
        print("FAIL: reviewed snapshot changed; audit intent then run --write", file=sys.stderr)
        return 1
    print(f"PASS: {result['migration_count']} migrations parsed; {result['create_table_statements']} table creates have explicit same-file grants; {result['surviving_created_tables']} surviving created tables have RLS enabled")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
