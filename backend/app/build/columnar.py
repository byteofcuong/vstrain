"""Chuyển cây Auspice v2 (JSON lồng nhau) sang dạng cột: các mảng song song theo thứ tự duyệt trước.

Auspice nhận một cây lồng nhau rồi tự làm phẳng trong trình duyệt, bằng đệ quy và `push(...spread)`; đó là
chỗ nó sập ở khoảng 125 nghìn node (phép đo F9). Ở đây việc làm phẳng được làm một lần ở server:
- node cha luôn đứng trước node con, nên trình duyệt duyệt cây bằng một vòng lặp;
- mỗi thuộc tính là một mảng số hoặc một cột mã hoá từ điển, đọc thẳng vào typed array;
- thuộc tính của tip nằm ở file riêng, tải khi cần và cập nhật được mà không dựng lại cây.
"""

from collections.abc import Sequence
from typing import Any

_DIV_DECIMALS = 7
_DATE_DECIMALS = 4  # 0,0001 năm là chưa tới một giờ


def _rounded(value: Any, decimals: int) -> float | None:
    return None if value is None else round(float(value), decimals)


def tree_arrays(auspice: dict[str, Any]) -> dict[str, Any]:
    """Các mảng song song của cây; chỉ số của node là vị trí của nó trong thứ tự duyệt trước."""
    name: list[str] = []
    parent: list[int] = []
    div: list[float | None] = []
    num_date: list[float | None] = []
    date_lower: list[float | None] = []
    date_upper: list[float | None] = []
    clade: list[str | None] = []
    tip_node: list[int] = []

    # Ngăn xếp thay cho đệ quy: cây thật có thể sâu hàng nghìn tầng.
    pending: list[tuple[dict[str, Any], int]] = [(auspice["tree"], -1)]
    while pending:
        node, parent_index = pending.pop()
        index = len(name)
        attrs = node.get("node_attrs", {})
        date = attrs.get("num_date", {})
        confidence = date.get("confidence") or (None, None)

        name.append(node["name"])
        parent.append(parent_index)
        div.append(_rounded(attrs.get("div"), _DIV_DECIMALS))
        num_date.append(_rounded(date.get("value"), _DATE_DECIMALS))
        date_lower.append(_rounded(confidence[0], _DATE_DECIMALS))
        date_upper.append(_rounded(confidence[1], _DATE_DECIMALS))
        clade.append(attrs.get("clade_membership", {}).get("value"))

        children = node.get("children") or []
        if not children:
            tip_node.append(index)
        # Đẩy ngược để con đầu tiên được lấy ra trước, giữ đúng thứ tự con của cây gốc.
        pending.extend((child, index) for child in reversed(children))

    return {
        "nodeCount": len(name),
        "tipCount": len(tip_node),
        "name": name,
        "parent": parent,
        "div": div,
        "numDate": num_date,
        "numDateLower": date_lower,
        "numDateUpper": date_upper,
        "clade": clade,
        "tipNode": tip_node,
    }


def encode_column(values: Sequence[str | None]) -> dict[str, Any]:
    """Mã hoá từ điển: danh sách giá trị khác nhau (xếp theo chữ cái) và mã của từng phần tử, -1 là thiếu."""
    distinct = sorted({value for value in values if value})
    code_of = {value: code for code, value in enumerate(distinct)}
    return {"values": distinct, "codes": [code_of.get(value, -1) if value else -1 for value in values]}
