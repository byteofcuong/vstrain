import pytest

from app.submissions.placement import Placement, node_names, read_placement


def node(name: str, div: float, *children: dict) -> dict:
    made: dict = {"name": name, "node_attrs": {"div": div}}
    if children:
        made["children"] = list(children)
    return made


def tree(root: dict) -> dict:
    return {"version": "v2", "meta": {}, "tree": root}


# Cây gốc dùng chung: ((A, B) N1, C) ROOT
BASE = tree(node("ROOT", 0.0, node("N1", 0.01, node("A", 0.02), node("B", 0.03)), node("C", 0.05)))
BASE_NAMES = node_names(BASE)


def test_the_names_of_a_tree_are_those_of_all_its_nodes():
    assert BASE_NAMES == {"ROOT", "N1", "A", "B", "C"}


def test_a_sample_hung_straight_on_an_existing_node_is_anchored_there():
    placed = tree(
        node("ROOT", 0.0, node("N1", 0.01, node("A", 0.02), node("B", 0.03), node("S0000009", 0.04)), node("C", 0.05))
    )

    assert read_placement(placed, BASE_NAMES, "S0000009") == Placement(
        parent_node="N1", branch_node=None, attach_div=0.01, div=0.04
    )


def test_a_sample_that_splits_the_branch_of_a_tip_names_that_tip_and_the_node_above():
    # Nextclade chẻ cành dẫn tới A bằng một node mới, rồi gắn mẫu vào node đó.
    split = node("nextclade__copy_of_A_for_placement_of_S0000009_#0", 0.015, node("A", 0.02), node("S0000009", 0.025))
    placed = tree(node("ROOT", 0.0, node("N1", 0.01, split, node("B", 0.03)), node("C", 0.05)))

    assert read_placement(placed, BASE_NAMES, "S0000009") == Placement(
        parent_node="N1", branch_node="A", attach_div=0.015, div=0.025
    )


def test_a_sample_that_splits_the_branch_of_an_inner_node_names_that_node():
    split = node("new", 0.004, node("N1", 0.01, node("A", 0.02), node("B", 0.03)), node("S0000009", 0.02))
    placed = tree(node("ROOT", 0.0, split, node("C", 0.05)))

    assert read_placement(placed, BASE_NAMES, "S0000009") == Placement(
        parent_node="ROOT", branch_node="N1", attach_div=0.004, div=0.02
    )


def test_the_order_of_the_children_does_not_matter():
    split = node("new", 0.015, node("S0000009", 0.025), node("A", 0.02))
    placed = tree(node("ROOT", 0.0, node("C", 0.05), node("N1", 0.01, node("B", 0.03), split)))

    assert read_placement(placed, BASE_NAMES, "S0000009") == Placement(
        parent_node="N1", branch_node="A", attach_div=0.015, div=0.025
    )


def test_new_nodes_stacked_on_each_other_still_lead_up_to_an_existing_node():
    inner = node("new-2", 0.018, node("A", 0.02), node("S0000009", 0.03))
    outer = node("new-1", 0.012, inner, node("S0000008", 0.02))
    placed = tree(node("ROOT", 0.0, node("N1", 0.01, outer, node("B", 0.03)), node("C", 0.05)))

    assert read_placement(placed, BASE_NAMES, "S0000009") == Placement(
        parent_node="N1", branch_node="A", attach_div=0.018, div=0.03
    )
    # Mẫu kia treo trên một node mới mà các con còn lại cũng đều mới: không có cành nào của cây gốc để chỉ.
    assert read_placement(placed, BASE_NAMES, "S0000008") == Placement(
        parent_node="N1", branch_node=None, attach_div=0.012, div=0.02
    )


def test_a_sample_that_is_not_in_the_tree_is_an_error():
    with pytest.raises(LookupError, match="S0000009"):
        read_placement(BASE, BASE_NAMES, "S0000009")


def test_a_sample_with_no_existing_node_above_it_is_an_error():
    placed = tree(node("new-root", 0.0, BASE["tree"], node("S0000009", 0.02)))

    with pytest.raises(ValueError, match="no node of the build above"):
        read_placement(placed, BASE_NAMES, "S0000009")


def test_a_sample_without_a_divergence_is_an_error():
    placed = tree(node("ROOT", 0.0, node("C", 0.05), {"name": "S0000009", "node_attrs": {}}))

    with pytest.raises(ValueError, match="divergence"):
        read_placement(placed, BASE_NAMES, "S0000009")


def test_a_sample_that_came_back_as_an_inner_node_is_an_error():
    placed = tree(node("ROOT", 0.0, node("S0000009", 0.02, node("C", 0.05))))

    with pytest.raises(ValueError, match="not a tip"):
        read_placement(placed, BASE_NAMES, "S0000009")


def test_a_very_deep_tree_is_read_without_recursion():
    # Cây dạng chiếc lược sâu 20.000 tầng: đệ quy sẽ vượt giới hạn của Python.
    deep = node("T20000", 2.0)
    for level in range(19_999, 0, -1):
        deep = node(f"N{level}", level / 10_000, node(f"T{level}", level / 10_000), deep)
    base = tree(deep)
    names = node_names(base)
    assert len(names) == 39_999

    # Gắn mẫu vào node sâu nhất.
    cursor = base["tree"]
    while cursor["children"][1].get("children"):
        cursor = cursor["children"][1]
    cursor["children"].append(node("S0000009", 2.5))

    assert read_placement(base, names, "S0000009").parent_node == "N19999"
