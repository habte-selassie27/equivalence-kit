"""Console entry point for the ``ekit`` command."""

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from equivalencekit.matrix_runner import run_matrix
from equivalencekit.scaffold import scaffold
from equivalencekit.diagnose import diagnose_receipt, diagnose_text, fetch_receipt, format_text
from equivalencekit.tighten import format_text as tighten_text, load_rule, run_tighten, write_init


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="ekit", description="EquivalenceKit developer tooling")
    parser.add_argument("--version", action="version", version="equivalencekit 0.1.0")
    sub = parser.add_subparsers(dest="command", required=True)

    audit = sub.add_parser("audit", help="audit a contract against the anti-pattern gallery")
    audit.add_argument("path", help="file or directory to audit")
    audit.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    audit.add_argument("--sarif", nargs="?", const="-", default=None, metavar="FILE",
                       help="emit SARIF 2.1.0 (stdout when FILE is omitted)")

    sc = sub.add_parser("scaffold", help="scaffold a contract from a pattern template")
    sc.add_argument("--pattern", required=True, help="P1..P6")
    sc.add_argument("--name", required=True, help="contract class name, e.g. VendorJudge")
    sc.add_argument("--out", required=True, help="output contract path")
    sc.add_argument("--matrix-out", default=None, help="output matrix JSON path")

    mx = sub.add_parser("matrix", help="run an acceptance matrix and perturbation suite")
    mx.add_argument("path", help="matrix JSON file or directory")
    mx.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    mx.add_argument("--check", action="store_true",
                    help="exit non-zero unless all cases and perturbations pass")

    dg = sub.add_parser("diagnose", help="diagnose a failed transaction from its receipt")
    dg.add_argument("txhash", nargs="?", help="transaction hash (requires the genlayer CLI)")
    dg.add_argument("--from-file", default=None,
                    help="read the receipt text from a file instead of calling genlayer")
    dg.add_argument("--json", action="store_true", help="emit machine-readable JSON")

    tn = sub.add_parser("tighten", help="run a user-supplied rule through a tightness report")
    tn.add_argument("--rules", help="Python module defining compare(leader, validator, context)")
    tn.add_argument("--fixtures", help="fixture JSON reusing the acceptance-matrix case shape")
    tn.add_argument("--pattern", default=None,
                    help="P1..P6: also run the kit's harmless/harmful perturbations "
                         "(the fixtures file needs a canonical output)")
    tn.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    tn.add_argument("--check", action="store_true",
                    help="exit non-zero unless the rule is tight")
    tn.add_argument("--init", action="store_true",
                    help="write a starter rules module and fixtures file")

    args = parser.parse_args(argv)

    if args.command == "audit":
        from equivalencekit.audit import main as audit_main
        aargv = ["audit", args.path]
        if args.json:
            aargv.append("--json")
        if args.sarif is not None:
            aargv.append("--sarif")
            if args.sarif != "-":
                aargv.append(args.sarif)
        return audit_main(aargv)

    if args.command == "scaffold":
        scaffold(args.pattern, args.name, Path(args.out),
                 Path(args.matrix_out) if args.matrix_out else None)
        return 0

    if args.command == "matrix":
        return run_matrix(Path(args.path), as_json=args.json, check=args.check)

    if args.command == "diagnose":
        if args.from_file:
            raw = Path(args.from_file).read_text()
            source = args.from_file
        elif args.txhash:
            try:
                raw = fetch_receipt(args.txhash)
            except RuntimeError as exc:
                print(str(exc))
                return 2
            source = args.txhash
        else:
            parser.error("diagnose requires a txhash or --from-file")
            return 2
        # Prefer structured receipt diagnosis when the input parses as JSON.
        try:
            import json as _json
            parsed = _json.loads(raw)
            diagnoses = diagnose_receipt(parsed)
        except (ValueError, TypeError):
            diagnoses = diagnose_text(raw)
        if args.json:
            print(json.dumps([asdict(d) for d in diagnoses], indent=2))
        else:
            print(format_text(diagnoses, source=source))
        return 0

    if args.command == "tighten":
        from equivalencekit.errors import KitError

        if args.init:
            try:
                rule_path, fixtures_path = write_init(Path())
            except KitError as exc:
                print(exc.code)
                return 2
            print(f"wrote {rule_path} and {fixtures_path}")
            print("next: ekit tighten --rules ekit_rule.py --fixtures ekit_fixtures.json --check")
            return 0
        if not args.rules or not args.fixtures:
            parser.error("tighten requires --rules and --fixtures (or --init)")
            return 2
        try:
            report = run_tighten(
                Path(args.rules), Path(args.fixtures),
                pattern_id=args.pattern,
            )
        except KitError as exc:
            print(exc.code)
            return 2
        if args.json:
            print(json.dumps(report.to_dict(), indent=2))
        else:
            print(tighten_text(report))
        if args.check and not report.tight:
            return 1
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
