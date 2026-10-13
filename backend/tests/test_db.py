import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError


def test_a_database_error_does_not_repeat_the_values_that_were_sent(session):
    # Thông báo của lỗi database đi vào log của server và vào `job.error`. Giá trị gửi kèm câu lệnh (email vừa
    # thử đăng nhập, tên mẫu, cả một genome) không được theo vào đó.
    with pytest.raises(ProgrammingError) as caught:
        session.execute(text("SELECT :typed FROM no_such_table"), {"typed": "someone@example.org"})

    assert "no_such_table" in str(caught.value)
    assert "someone@example.org" not in str(caught.value)
