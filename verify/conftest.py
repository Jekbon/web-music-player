"""pytest-playwright 配置：Chromium + 允许自动播放 + 证据收集。"""
import json
import os

import pytest

REPORT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e_report.json")


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    args = list(browser_type_launch_args.get("args") or [])
    args += [
        "--autoplay-policy=no-user-gesture-required",
        "--no-sandbox",
        "--disable-dev-shm-usage",
    ]
    return {**browser_type_launch_args, "args": args}


@pytest.fixture()
def console_errors(page):
    """收集页面 console error 与未捕获异常。"""
    errors = []

    def _on_console(m):
        if m.type == "error":
            errors.append(f"[console.error] {m.text}")

    page.on("console", _on_console)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
    return errors


@pytest.fixture()
def evidence(request):
    d = {}
    request.config._e2e_evidence[request.node.name] = d
    return d


def pytest_configure(config):
    config._e2e_evidence = {}
    config._e2e_outcomes = {}


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call":
        item.config._e2e_outcomes[item.name] = {
            "outcome": rep.outcome,
            "longrepr": str(rep.longrepr) if rep.failed else "",
        }


def pytest_sessionfinish(session, exitstatus):
    report = {}
    for name, ev in session.config._e2e_evidence.items():
        oc = session.config._e2e_outcomes.get(name, {})
        report[name] = {
            "pass": oc.get("outcome") == "passed",
            "evidence": ev,
            "failure_detail": oc.get("longrepr", ""),
        }
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
