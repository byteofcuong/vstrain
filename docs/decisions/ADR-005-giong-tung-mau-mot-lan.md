# ADR-005: Gióng từng mẫu một lần lúc nạp, build chỉ ghép lại

## Status
Accepted

## Date
2026-10-12

## Context
Pipeline của Nextstrain gióng lại toàn bộ chuỗi ở mỗi lần build bằng `augur align` (MAFFT). Phép đo P1 trên DENV1:

| Số chuỗi | 100 | 500 | 1.000 | 2.000 | 5.000 |
|---|---|---|---|---|---|
| `augur align` (giây) | 3,0 | 13,5 | 29,4 | 72,2 | 318,5 |

Thời gian tăng nhanh hơn tuyến tính (số mũ khoảng 1,17), và thêm một mẫu là gióng lại tất cả. Kết quả gióng của một mẫu còn phụ thuộc các mẫu khác trong cùng lô, nên không lưu lại để dùng tiếp được.

Hệ thống này nhận mẫu liên tục và build theo lịch, nên một việc làm đi làm lại cho những mẫu không đổi là lãng phí.

## Decision
- Mỗi mẫu được gióng theo reference của lineage bằng Nextclade, đúng một lần, và kết quả được lưu trong `sample_alignment`: chuỗi đã gióng dài đúng bằng reference (phần chèn bị bỏ), số nucleotide hợp lệ, độ phủ, số thay thế.
- Build không có bước gióng hàng. Bước `prepare` đọc các chuỗi đã gióng của những mẫu được chọn và viết thành file alignment; chỗ không có dữ liệu được đổi thành `N`, như `augur align --fill-gaps`.
- Mẫu được gióng lại khi chuỗi thô của nó đổi (so hash) hoặc khi người vận hành yêu cầu sau khi đổi cấu hình.
- Nextclade vẫn gióng được genome của serotype khác, nên có thêm ngưỡng phân kỳ: khác reference quá 25% số vị trí thì coi là không gióng được.
- Genome cần ít nhất 10.000 nucleotide hợp lệ sau khi gióng mới được vào build.

## Alternatives Considered

### Giữ `augur align`, cache theo file như Snakemake
- Ưu: không đổi công cụ.
- Nhược: cache của Snakemake theo cả file đầu vào; thêm một mẫu là file đổi và phải gióng lại tất cả.
- Loại: không giải quyết được việc gióng lại.

### MAFFT `--add` vào alignment có sẵn
- Ưu: vẫn là MAFFT, chỉ gióng phần mới.
- Nhược: phải giữ một alignment chung cho mỗi dataset; mẫu thuộc nhiều dataset thì có nhiều bản; alignment phình dần và khó bỏ mẫu ra.
- Loại: trạng thái gắn với dataset chứ không gắn với mẫu.

### Gióng lúc build nhưng dùng Nextclade
- Ưu: nhanh hơn MAFFT nhiều, không cần bảng mới.
- Nhược: vẫn làm lại việc đã làm; mẫu vừa nộp không có sẵn chuỗi đã gióng cho việc kiểm tra chất lượng và đặt tạm vào cây.
- Loại: lưu kết quả thì mỗi mẫu chỉ tốn một lần, và bước nộp mẫu cũng cần chính kết quả đó.

## Consequences
- Đo trên dữ liệu thật (`do-dac/results/W3-giong-mau-webapp/`): 21.909 genome của bốn serotype được gióng trong một job 34 giây, trong đó Nextclade chạy 17 giây (129 giây CPU, 8 luồng). 21.892 gióng được, 17 không.
- Bước `prepare` của một build 2.000 mẫu mất 0,1 giây, so với 72 giây của `augur align`.
- Tổng thời gian build không giảm tương ứng. Build trên đúng tập 2.000 mẫu của P1 (`do-dac/results/W4-build-webapp/build_tap_p1.json`) mất 755 giây so với 771 giây: phần gióng mất đi 77 giây, nhưng `refine` chậm hơn 75 giây trong lần chạy đó (649 so với 574 giây). Mỗi bên mới có một lần chạy, nên chưa biết đó là nhiễu hay do alignment của Nextclade khác MAFFT. `refine` vẫn chiếm khoảng 85% thời gian build; quyết định này không giải quyết nút cổ chai đó.
- Mọi mẫu của một lineage nằm chung một hệ toạ độ (reference), nên một mẫu dùng được cho nhiều dataset.
- Phần chèn so với reference bị bỏ khỏi alignment; đột biến chèn không hiện trên cây. `augur align --remove-reference` của Nextstrain cũng cho kết quả tương tự ở điểm này.
- Gióng từng cặp với reference không tận dụng thông tin giữa các mẫu như gióng đa chuỗi. Với virus có genome bảo thủ trong một serotype như dengue thì chấp nhận được; với pathogen nhiều chèn, xoá thì cần đánh giá lại.
- Ngưỡng 15% ban đầu đã loại nhầm 39 genome DENV2 thể rừng (khác reference 17,6 đến 18,6%); ngưỡng hiện tại đặt theo phân bố đo được, và cần xem lại khi thêm pathogen khác.
- Thêm một bảng lớn: `sample_alignment` chiếm 92 MB cho 21.909 genome.
