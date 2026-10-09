"""不调用模型，只检查日期、JSON 解析和操作校验。运行：uv run python test_prepare.py"""

from planner import Action, Plan, PlanError, parse_plan, prepare, resolve_dates


def test_resolve_dates_keeps_valid_input():
    assert resolve_dates("2026-10-09", "2026-10-08") == ("2026-10-09", "2026-10-08")


def test_parse_fenced_json():
    plan = parse_plan('```json\n{"reply":"好","actions":[]}\n```')
    assert plan.reply == "好"
    assert plan.actions == []


def test_prepare_adds_confirm_after_delete():
    plan = prepare(
        Plan(
            reply="删除昨天",
            actions=[
                Action(op="fill", selector="#filter-date-from", value="2026-10-08"),
                Action(op="click", selector="#btn-delete-filtered"),
            ],
        ),
        "http://127.0.0.1:4173/",
    )
    assert plan.actions[-1].selector == "#btn-confirm-ok"


def test_prepare_does_not_double_confirm():
    plan = prepare(
        Plan(
            reply="删除一辆",
            actions=[
                Action(op="click", selector='button[data-action="delete"][data-plate="京A10293"]'),
                Action(op="click", selector="#btn-confirm-ok"),
            ],
        ),
        "http://127.0.0.1:4173/",
    )
    assert [item.selector for item in plan.actions].count("#btn-confirm-ok") == 1


def test_prepare_rejects_unknown_click():
    try:
        prepare(Plan(reply="点一下", actions=[Action(op="click", selector="#not-a-control")]), "http://127.0.0.1:4173/")
    except PlanError as exc:
        assert "不能点击" in str(exc)
    else:
        raise AssertionError("应当拒绝未知选择器")


def test_prepare_drops_local_goto():
    plan = prepare(
        Plan(reply="打开", actions=[Action(op="goto", value="http://127.0.0.1:4173/")]),
        "http://127.0.0.1:4173/",
    )
    assert plan.actions == []


if __name__ == "__main__":
    test_resolve_dates_keeps_valid_input()
    test_parse_fenced_json()
    test_prepare_adds_confirm_after_delete()
    test_prepare_does_not_double_confirm()
    test_prepare_rejects_unknown_click()
    test_prepare_drops_local_goto()
    print("ok")
