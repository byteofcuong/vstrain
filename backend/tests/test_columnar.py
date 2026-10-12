from app.build.columnar import encode_column, tree_arrays


def node(name: str, div: float, date: float, children: list | None = None, clade: str | None = None) -> dict:
    attrs = {"div": div, "num_date": {"value": date, "confidence": [date - 0.5, date + 0.5]}}
    if clade:
        attrs["clade_membership"] = {"value": clade}
    result = {"name": name, "node_attrs": attrs}
    if children:
        result["children"] = children
    return result


def small_tree() -> dict:
    #  root ─┬─ A
    #        └─ N1 ─┬─ B
    #               └─ C
    inner = node("N1", 0.05, 2000.5, [node("B", 0.07, 2003.25, clade="II"), node("C", 0.09, 2004.0, clade="II")], "II")
    return {"tree": node("root", 0.0, 2000.0, [node("A", 0.1, 2001.123456, clade="I"), inner], "I")}


def test_nodes_are_listed_parent_first_in_parallel_arrays():
    arrays = tree_arrays(small_tree())

    assert arrays["name"] == ["root", "A", "N1", "B", "C"]
    assert arrays["parent"] == [-1, 0, 0, 2, 2]
    assert arrays["div"] == [0.0, 0.1, 0.05, 0.07, 0.09]
    assert arrays["numDate"] == [2000.0, 2001.1235, 2000.5, 2003.25, 2004.0]
    assert (arrays["nodeCount"], arrays["tipCount"]) == (5, 3)


def test_tips_are_listed_by_their_node_index_in_tree_order():
    arrays = tree_arrays(small_tree())

    assert arrays["tipNode"] == [1, 3, 4]
    assert [arrays["name"][index] for index in arrays["tipNode"]] == ["A", "B", "C"]


def test_date_confidence_and_clade_of_every_node_are_kept():
    arrays = tree_arrays(small_tree())

    assert arrays["numDateLower"] == [1999.5, 2000.6235, 2000.0, 2002.75, 2003.5]
    assert arrays["numDateUpper"] == [2000.5, 2001.6235, 2001.0, 2003.75, 2004.5]
    assert arrays["clade"] == ["I", "I", "II", "II", "II"]


def test_a_parent_always_comes_before_its_children_and_the_tree_can_be_rebuilt():
    original = small_tree()
    arrays = tree_arrays(original)

    children: dict[str, list[str]] = {}
    for index, parent in enumerate(arrays["parent"]):
        assert parent < index
        if parent >= 0:
            children.setdefault(arrays["name"][parent], []).append(arrays["name"][index])

    assert children == {"root": ["A", "N1"], "N1": ["B", "C"]}


def test_a_very_deep_tree_is_converted_without_recursion():
    tree = node("tip-0", 0.0, 2000.0)
    for depth in range(1, 5000):
        tree = node(f"node-{depth}", 0.0, 2000.0, [node(f"tip-{depth}", 0.0, 2000.0), tree])

    arrays = tree_arrays({"tree": tree})

    assert (arrays["nodeCount"], arrays["tipCount"]) == (9999, 5000)
    assert arrays["name"][:3] == ["node-4999", "tip-4999", "node-4998"]


def test_a_node_without_a_date_or_clade_gets_null():
    arrays = tree_arrays(
        {"tree": {"name": "root", "node_attrs": {"div": 0}, "children": [{"name": "A", "node_attrs": {}}]}}
    )

    assert arrays["numDate"] == [None, None]
    assert arrays["div"] == [0.0, None]
    assert arrays["clade"] == [None, None]


def test_a_column_is_dictionary_encoded_with_minus_one_for_missing():
    column = encode_column(["Vietnam", "Thailand", None, "Vietnam", "", "Brazil"])

    assert column == {"values": ["Brazil", "Thailand", "Vietnam"], "codes": [2, 1, -1, 2, -1, 0]}


def test_an_empty_column_has_no_values():
    assert encode_column([None, None]) == {"values": [], "codes": [-1, -1]}
