# Spec: module `submission` (mốc M5, phần nộp mẫu)

Trạng thái: **đã triển khai và đã qua review độc lập** (2026-10-13), kể cả việc sửa mẫu đã nộp (bổ sung sau mốc M7). Tiêu chí 1 ở 5.000 tip và tiêu chí 1b được đo ở mốc M7: xem `docs/KET-QUA.md`. Các câu hỏi mở dùng phương án đề xuất.

## Objective

Một phòng xét nghiệm nộp một genome và thấy nó trên cây trong vòng chưa tới một phút, không phải chờ lần build kế tiếp.

Vấn đề đã đo: với Nextstrain, thêm một mẫu là dựng lại toàn bộ (771 giây ở 2.000 chuỗi, 2.020 giây ở 5.000). Prototype A cho thấy Nextclade đặt 100 mẫu vào cây có sẵn trong 1,9 đến 4,4 giây, và hàng xóm gần nhất của mẫu trùng với cây dựng lại ở 88–91% trường hợp (trần của chính phép dựng lại là 94–97%).

## Luồng

1. Người nộp (đã đăng nhập) gửi form: file FASTA, tên mẫu, ngày lấy mẫu (biết tới ngày, tháng hoặc năm), tỉnh (chọn từ danh sách đơn vị hành chính có hiệu lực vào ngày đó) và vật chủ.
2. API kiểm tra, lưu mẫu với trạng thái `received`, xếp job `ingest_sample` đứng trước các job dựng cây.
3. Worker gióng mẫu theo reference của cả bốn serotype và giữ kết quả gần nhất (người nộp không phải khai serotype), rồi kết luận: `accepted`, hoặc `rejected` kèm lý do.
4. Worker gắn mẫu đã được nhận vào cây của build hiện hành của mọi dataset cùng serotype, bằng `nextclade run --input-tree`, và lưu chỗ gắn vào `sample_placement`.
5. Viewer lấy các tip tạm qua `GET /api/datasets/{slug}/placements` và vẽ chồng lên cây, bằng hình khác với tip của build.
6. Lần build kế tiếp chọn cả mẫu đã nộp; mẫu vào build thành tip chính thức. Sau mỗi build, job `place_pending` gắn lại các mẫu đã nộp mà cây mới chưa có.

## Thiết kế

### Dữ liệu

- `sample.status`: `received` (vừa nộp), `accepted`, `rejected`, `hidden` (admin ẩn). Chỉ mẫu `accepted` là công khai và được chọn vào build. Bản ghi GenBank mặc định là `accepted`.
- `submission`: mẫu nào do ai nộp, job kiểm tra của nó, và lý do từ chối (một mã để giao diện dịch, một câu cho người đọc log).
- `sample_placement` (khoá: mẫu, build): `parent_node` (node gần nhất phía trên mẫu mà cây của build có), `branch_node` (node mà cành dẫn tới nó bị chẻ để gắn mẫu, nếu có), `attach_div`, `div`, `private_mutations`, `clade`. Tên node chỉ có nghĩa với cây của đúng build đó.

### Kiểm tra lúc nộp (`app/submissions/validate.py`)

- File: tối đa 2 MB, đúng một bản ghi FASTA, chỉ mã nucleotide của IUPAC (không nhận dấu gạch: chuỗi nộp là chuỗi thô), U đổi thành T, dài từ 10.000 tới 11.808 nucleotide, và có ít nhất 10.000 vị trí là A, C, G hoặc T. Hai mốc độ dài lấy từ cấu hình các lineage dengue.
- Tên mẫu là tên hiển thị: giữ nguyên chữ người nộp gõ, sau khi chuẩn hoá NFC và bỏ khoảng trắng hai đầu (tên gõ ở dạng tổ hợp được lưu khác byte nhưng hiển thị y hệt), 1 tới 300 ký tự trên một dòng, không ký tự điều khiển hay ký tự định dạng vô hình. Nó không bao giờ tới công cụ (ADR-003): công cụ chỉ thấy mã nội bộ.
- Ngày lấy mẫu: `YYYY`, `YYYY-MM` hoặc `YYYY-MM-DD`, không ở tương lai (tính theo giờ Việt Nam), lưu thành một khoảng ngày không vượt quá hôm nay.
- Tỉnh là mã đơn vị cấp tỉnh, và phải tồn tại vào một lúc nào đó trong khoảng ngày lấy mẫu: bộ 63 tới 2025-06-30, bộ 34 từ 2025-07-01, cả hai khi chỉ biết năm 2025.
- Mọi lỗi được báo trong một lượt, mỗi lỗi có tên trường và một mã (`NOT_FASTA`, `SEQUENCE_TOO_SHORT`, `UNIT_NOT_VALID_ON_DATE`, ...). Lời báo không chép lại nội dung file.
- Một người có nhiều nhất 20 mẫu chờ kiểm tra cùng lúc (429 `TOO_MANY_PENDING`). "Chờ" là job kiểm tra còn trong hàng đợi hoặc đang chạy; mẫu có job đã hỏng không chiếm chỗ.
- Một người nộp nhiều nhất 200 mẫu trong 24 giờ (429 `TOO_MANY_TODAY`). Trần này giới hạn số mẫu tạm một tài khoản chất được lên cây giữa hai lần build; mỗi mẫu tạm là một lần chạy Nextclade sau từng build. Bản đầu của đặc tả xếp giới hạn theo thời gian vào việc chưa làm; trần này được thêm có chủ ý sau review, vì trần số mẫu đang chờ chỉ giữ nhịp chứ không giới hạn tổng số. Mọi lần nộp đều được tính, kể cả mẫu bị từ chối và mẫu có job hỏng.
- Thân của một request ghi tối đa 4 MB và phải khai độ dài (413, 411).

### API

| Endpoint | Ai | Việc |
|---|---|---|
| `POST /api/submissions` | người nộp | nộp một mẫu; 201 kèm tình trạng của mẫu |
| `GET /api/submissions` | người nộp | mẫu của mình, mới nhất trước; admin thêm `scope=all` để xem của mọi người |
| `GET /api/submissions/{id}` | người nộp, admin | một mẫu; mẫu của người khác trả 404 |
| `GET /api/datasets/{slug}/placements` | mọi người | tip tạm của build hiện hành, kèm chỉ số node trong `tree.json` của bản publish đang phát |
| `POST /api/admin/samples/{id}/hide`, `/unhide` | admin | ẩn hoặc hiện lại một mẫu |
| `GET /api/units` | mọi người | danh mục đơn vị hành chính kèm thời gian hiệu lực |

Tình trạng của một mẫu đã nộp (`stage`): `processing`, `failed` (job hỏng), `rejected`, `hidden`, `accepted` (đạt, chưa có cây để gắn), `placement_failed` (đạt, nhưng bước gắn bị lỗi; được gắn lại sau lần build kế tiếp), `placed` (đang là tip tạm), `in_tree` (đã là tip chính thức). Mẫu đạt kiểm tra vẫn là `processing` cho tới khi job của nó thử gắn xong.

### Worker

- `ingest_sample` chạy lại được: mẫu đã có kết luận không bị kiểm tra lần hai, mẫu đã là tip chính thức không bị gắn tạm.
- Lý do từ chối: `NOT_THIS_PATHOGEN` (không reference nào đủ gần; ngưỡng 25% vị trí khác reference) và `TOO_FEW_VALID_SITES` (sau khi gióng còn dưới 10.000 vị trí đọc được).
- Bản triển khai có worker thứ hai (service `ingest`) chỉ nhận `ingest_sample`, để một mẫu nộp trong lúc worker chung đang dựng cây không phải chờ.
- Một lần gắn bị lỗi (công cụ hỏng, cây không đọc được) không chặn các lần gắn sau nó: `place_pending` thử hết mọi mẫu, `ingest_sample` thử hết mọi dataset, rồi job mới kết thúc là hỏng, kèm danh sách mẫu hoặc dataset hỏng và lý do. Job hỏng không tự chạy lại.
- Lùi migration 0009 bị từ chối khi còn mẫu chưa công khai (`received`, `rejected`, `hidden`): schema cũ không có cột `status`, nên các mẫu đó sẽ hiện ra ở API công khai.

### Viewer

- Tip tạm là hình thoi rỗng nối bằng nét đứt tới điểm nó tách khỏi cành. Hình dạng, không phải màu, phân biệt nó với tip của build.
- Trên trục thời gian tip tạm đứng ở ngày lấy mẫu do người nộp khai (giữa khoảng ngày); trên trục phân kỳ, ở độ phân kỳ Nextclade tính. Trục được nới để chứa mọi tip tạm.
- Tip tạm có tooltip, bảng chi tiết, và công tắc hiện, ẩn. Bộ lọc theo ngày áp cho ngày của chính nó; khi một bộ lọc theo thuộc tính hoặc địa bàn đang bật thì tip tạm không được hiện, vì nó không có mặt trong các cột của build.
- Trang `#/submit` (form) và `#/mine` (mẫu đã nộp; tự tải lại trong lúc còn mẫu đang được kiểm tra).

## Tiêu chí nghiệm thu

| # | Tiêu chí | Ngưỡng | Kết quả |
|---|---|---|---|
| 1 | Từ lúc bấm nộp tới lúc tip tạm có trong `GET .../placements`, dataset ≤ 5.000 tip | ≤ 30 giây | **đạt ở cây 1.964 tip; chưa đo ở 5.000 tip** (để mốc M7): 20 lần nộp trên build DENV1 thật (1.964 tip), qua nginx: trung vị 1,07 giây, nhanh nhất 0,67, chậm nhất 1,18. Khi worker chung bị dừng: 5 lần, trung vị 1,13 giây. Số liệu: `do-dac/results/W7-nop-mau/` |
| 1b | Hàng xóm gần nhất của mẫu đặt tạm trùng với cây dựng lại (dùng lại `protoA_danh_gia.py`) | ≥ 85% trên 100 mẫu để dành | **chưa đo trên ứng dụng**; để mốc M7 |
| 5 | Mẫu tên "Hà_Nội/01/2024" đi trọn luồng nộp, đặt tạm và build | Qua | **đạt**: `tests/test_ingest.py` (công cụ thật: nộp, tip tạm, build kế tiếp có mẫu, tên nằm trong bản publish, không file nào của job chứa tên) và `frontend/e2e/submission.spec.ts` (qua giao diện, tên có cả `; touch pwned`) |
| S1 | File không phải FASTA, chuỗi quá ngắn, sai ký tự, quá lớn | Từ chối với lỗi 422 nói rõ lý do, không tạo job | **đạt**: 19 trường hợp trong `tests/test_submissions_api.py`. File trên 2 MB nhận 422 `FASTA_TOO_LARGE`. Khác chữ của tiêu chí ở một chỗ, có chủ ý: request trên 4 MB nhận 413 `BODY_TOO_LARGE`, vì nó bị chặn trước khi thân được đọc vào bộ nhớ |
| S2 | Genome khác serotype của dataset | Được gán đúng serotype hoặc bị từ chối có lý do | **đạt**: genome DENV2 được nhận là `denv2`; chuỗi ngẫu nhiên bị từ chối `NOT_THIS_PATHOGEN` |
| S3 | Người nộp chỉ thấy và sửa được mẫu của mình | Có test | **đạt**; phần "sửa" ở mục "Sửa mẫu đã nộp" |

## Sửa mẫu đã nộp (bổ sung sau mốc M7)

Trạng thái: **đã triển khai** (2026-10-13).

Người nộp gõ nhầm ngày hoặc chọn nhầm tỉnh là chuyện thường. Trước phần này, cách duy nhất để sửa là nhờ admin ẩn mẫu rồi nộp lại, tức là một mẫu mới, một mã mới và một lần kiểm tra mới cho cùng một chuỗi.

### Thiết kế

- `PATCH /api/submissions/{internalId}` với đủ bốn trường `displayName`, `collectionDate`, `unitCode`, `host`. Chuỗi không sửa được: chuỗi khác là mẫu khác, phải nộp mới.
- **Chỉ người đã nộp mẫu đó sửa được.** Người nộp khác nhận 404, như khi xem. Admin xem được mọi mẫu nhưng không sửa hộ: nhận 403. Việc của admin vẫn là ẩn mẫu.
- **Chỉ mẫu đã được nhận** (`accepted`) và không có việc kiểm tra nào đang chờ hoặc đang chạy mới sửa được. Mẫu đang được kiểm tra nhận 409 `SAMPLE_BEING_CHECKED`; mẫu bị từ chối, bị ẩn, hoặc có việc kiểm tra đã hỏng nhận 409 `SAMPLE_NOT_EDITABLE`.
- Bốn trường qua đúng các phép kiểm tra của lúc nộp, với cùng mã lỗi cho từng trường, và mọi lỗi được báo trong một lượt. Tỉnh phải tồn tại trong khoảng ngày lấy mẫu mới.
- Gửi lại đúng các giá trị đang có thì không có gì được ghi: không nhật ký, không việc nền.
- Mỗi lần sửa có một dòng nhật ký `sample_edited` ghi các trường đã đổi (tên trường, không ghi giá trị).

### Sửa xong thì cây đổi thế nào

| Mẫu đang là | Tên, tỉnh, vật chủ, ngày hiển thị | Vị trí trên trục thời gian |
|---|---|---|
| Tip tạm | Đổi ngay: API tip tạm đọc thẳng từ database | Đổi ngay: tip tạm đứng ở ngày người nộp khai |
| Tip chính thức của một cây đang phát | Đổi sau một việc `publish_build` (viết lại các cột từ database, cây không bị dựng lại), như khi sửa địa danh | Đổi ở lần dựng cây kế tiếp. Ngày nằm trong hash đầu vào, nên lịch thấy tập đầu vào đã đổi và xếp một lần dựng khi tới hạn |

### Giao diện

- Trang `#/mine`: mẫu sửa được có liên kết "Sửa", chỉ ở danh sách mẫu của chính mình.
- Trang `#/mine/<mã>/edit`: bốn trường của form nộp, điền sẵn giá trị đang có; nút lưu và liên kết quay lại. Lưu xong quay về `#/mine` kèm lời báo. Lỗi của từng trường hiện cạnh trường đó, như ở form nộp.

### Tiêu chí nghiệm thu

| # | Tiêu chí | Ngưỡng | Kết quả |
|---|---|---|---|
| S3 | Người nộp sửa được mẫu của mình; người nộp khác và admin không sửa được | Có test: 200, 404, 403; mẫu của người khác không đổi | **đạt**; thêm 401 cho khách và 403 khi thiếu header chống CSRF |
| S4 | Giá trị sai bị từ chối với đúng mã lỗi của lúc nộp, và không có gì được ghi | Có test cho từng trường và cho tỉnh không tồn tại vào ngày mới | **đạt**: 11 trường hợp, gồm một lần sai cả bốn trường được báo trong một lượt |
| S5 | Mẫu chưa được nhận, đang được kiểm tra, bị từ chối hoặc bị ẩn không sửa được | Có test cho từng trạng thái | **đạt**: 5 trạng thái, hai mã lỗi 409 |
| S6 | Sửa một tip chính thức: bản publish mới mang giá trị mới, `tree.json` giữ nguyên từng byte, không việc dựng cây nào được xếp | Có test | **đạt**; cây không chứa mẫu thì không bị publish lại |
| S7 | Sửa ngày của một tip chính thức làm lịch dựng lại cây khi tới hạn; sửa tên thì không | Có test | **đạt**, kiểm ở mức hash đầu vào: sửa tên và vật chủ giữ nguyên hash, sửa ngày làm hash đổi |
| S8 | Sửa qua giao diện trên stack thật: tip tạm mang tên và tỉnh mới | Test đầu-cuối | **đạt**: `frontend/e2e/submission.spec.ts`, hai test (người nộp sửa; admin không sửa được) |

Các test backend nằm ở cuối `tests/test_submissions_api.py`. Kiểm chứng lúc xong (2026-10-13): backend `pytest` trong image api 631 passed, 17 skipped, trong image worker 648 passed; frontend 282 passed; `npm run e2e` 48 passed; `npm run e2e:web` 54 passed. Mutation check riêng cho phần này: 19 chỗ sửa thử, cả 19 bị test bắt. Ảnh chụp trên stack thật ở `do-dac/results/W10-sua-mau/anh/`.

Điều cần biết:
- Hai lần sửa gửi cùng lúc thì lần ghi sau thắng; không có khoá hay kiểm tra phiên bản. Chỉ một tài khoản sửa được một mẫu, nên đây là một người tự ghi đè lên chính mình.
- Mẫu đang là tip chính thức mà bị sửa ngày: ngày hiển thị đổi sau việc publish lại, còn vị trí trên trục thời gian vẫn là của cây đã dựng cho tới lần dựng kế tiếp. Trong khoảng đó hai thứ không khớp nhau.
- Mỗi lần sửa một tip chính thức xếp một việc publish lại (khoảng 0,2 giây ở cây 2.000 tip); không có trần riêng cho số lần sửa.
- Admin không sửa hộ được. Muốn sửa dữ liệu của một phòng xét nghiệm thì phòng đó tự sửa, hoặc admin ẩn mẫu.

## Chưa làm

- Nộp nhiều chuỗi một lần.
- Tip tạm trên bản đồ: bản đồ chỉ đếm tip của build.
- Lọc tip tạm theo thuộc tính (tỉnh, vật chủ, genotype).
- Phát hiện nộp trùng: hai lần nộp cùng một chuỗi thành hai mẫu.
- Xếp lại job kiểm tra đã hỏng. Mẫu của nó hiện "Việc kiểm tra bị lỗi" và ở lại trạng thái `received`; hiện chỉ có cách nộp lại. Thuộc trang theo dõi job của mốc M6.
- Trần tổng số mẫu tạm của một dataset, và phân trang cho `GET .../placements`. Hiện số mẫu tạm chỉ bị chặn qua trần 200 mẫu mỗi tài khoản mỗi ngày.
- Test cho hai job của cùng một mẫu chạy đồng thời. Phân tích tĩnh không thấy cuộc đua gây sai (chỗ gắn được ghi đè theo khoá chính), nhưng chưa có test.
- Lùi migration 0009 trên database thật có dữ liệu nộp: mới thử trên database của test.

## Review độc lập (2026-10-13)

Một reviewer không viết mã này làm hai bước: trước tiên chỉ đọc yêu cầu và viết ra 23 điều sẽ kiểm, sau đó mới đọc mã backend và bằng chứng. Kết quả: 18 điều đạt, 2 không đạt, 3 không xác định được; không tìm thấy lỗ rò dữ liệu hay đường chèn lệnh. Mỗi phát hiện được đối chiếu với mã trước khi sửa.

| Phát hiện | Xử lý |
|---|---|
| Trần 20 mẫu đang chờ đếm cả mẫu có job đã hỏng. Job hỏng không tự chạy lại, nên sau 20 sự cố một phòng xét nghiệm nhận 429 vĩnh viễn | Đã sửa: đếm job còn chờ hoặc đang chạy |
| `place_pending` và `place_sample` dừng ở lần gắn lỗi đầu tiên: một mẫu "độc" chặn mọi mẫu đứng sau nó, sau mỗi lần build | Đã sửa: mỗi lần gắn được thử riêng; job vẫn kết thúc là hỏng sau khi đã thử hết |
| Mẫu đạt kiểm tra mà bước gắn hỏng hiện "chưa có cây để gắn" | Đã sửa: tình trạng riêng `placement_failed` |
| Số mẫu tạm không có trần (mức nghi ngờ): một tài khoản nộp liên tục, mỗi mẫu được kiểm tra trong một giây rồi không còn bị tính | Đã chặn bằng trần 200 mẫu mỗi tài khoản trong 24 giờ; trần theo dataset và phân trang chưa làm |
| Lùi migration 0009 làm mẫu chưa công khai thành công khai | Đã sửa: migration từ chối lùi khi còn mẫu như vậy |
| Tiêu chí 1 mới đo ở 1.964 tip, tiêu chí viết "≤ 5.000 tip" | Không sửa được bằng mã; ghi rõ ở bảng tiêu chí, đo ở mốc M7 |
| S1 viết 422 nhưng request trên 4 MB nhận 413 | Giữ nguyên, ghi rõ ở bảng tiêu chí |
| Tên mẫu được chuẩn hoá NFC, không phải "nguyên văn" từng byte | Giữ nguyên, ghi rõ ở mục kiểm tra lúc nộp |

Reviewer đọc lại bản sửa (commit `7082874`) và chấp nhận: năm phát hiện có sửa mã đều đã được xử lý, không có lỗi mới ở mức chặn. Nó lưu ý hai điều đã biết: `except Exception` quanh mỗi lần gắn bắt cả lỗi mất kết nối database (khi đó mọi lần gắn sau cũng hỏng và job vẫn kết thúc là hỏng), và việc giữ nguyên độ ưu tiên của `place_pending` cùng endpoint tip tạm không phân trang chỉ ổn ở quy mô vài chục tài khoản.

Reviewer không đọc frontend. Phần đó dựa vào test đầu-cuối trên stack thật, mutation check, và một lần rà: mã frontend không dùng `innerHTML` hay `dangerouslySetInnerHTML`, nên tên mẫu luôn được React thoát ký tự khi hiển thị.

## Quyết định cho các câu hỏi mở

1. **Mẫu nộp hiện công khai ngay khi đạt kiểm tra chất lượng**, gắn nhãn "tạm"; admin có nút ẩn.
2. Mỗi lần nộp một chuỗi.
3. Dữ liệu nộp trong đồ án là dữ liệu công khai dùng để thử. Khi có dữ liệu thật của phòng xét nghiệm thì cần thoả thuận chia sẻ dữ liệu; nằm ngoài phạm vi kỹ thuật này.
