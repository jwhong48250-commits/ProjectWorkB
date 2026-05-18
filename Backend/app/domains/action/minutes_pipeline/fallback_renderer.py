"""
ReportLab 기반 회의록 PDF 생성 — Playwright 미설치 시 폴백.
마크다운은 제한적으로 HTML 마크업으로 변환해 Paragraph에 넣는다.
"""
import html
import io
import logging
import re
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.domains.action.minutes_pipeline.data_mapper import MinuteFields

logger = logging.getLogger(__name__)

_FONT_STORAGE_DIR = Path(tempfile.gettempdir()) / "workb-fonts"

_FONT_REGULAR = "NanumGothic"
_FONT_BOLD = "NanumGothicBold"
_FONT_REGISTERED = False

_SYSTEM_FONT_CANDIDATES: list[tuple[str, str, str | None]] = [
    ("NanumGothic", "/Library/Fonts/NanumGothic.ttf", "/Library/Fonts/NanumGothicBold.ttf"),
    ("AppleGothic", "/System/Library/Fonts/Supplemental/AppleGothic.ttf", None),
    ("AppleGothic", "/System/Library/Fonts/AppleGothic.ttf", None),
    ("NanumGothic", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
     "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"),
    ("NotoSansCJK", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", None),
    ("NotoSansCJK", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", None),
]


def _markdown_to_reportlab_markup(text: str) -> str:
    """markdown → ReportLab Paragraph가 받을 수 있는 단순 마크업."""
    if not (text or "").strip():
        return ""
    import markdown as _md

    h = _md.markdown(text, extensions=["tables", "nl2br", "fenced_code"])
    h = re.sub(r"(?is)<script[^>]*>.*?</script>", "", h)
    h = re.sub(r"(?is)<style[^>]*>.*?</style>", "", h)

    def _flatten_table(m: re.Match) -> str:
        block = m.group(0)
        block = re.sub(r"(?is)<thead.*?</thead>", "", block)
        block = re.sub(r"(?is)<tbody>", "", block)
        block = re.sub(r"(?is)</tbody>", "", block)
        block = re.sub(r"(?is)<tr[^>]*>", "\n", block)
        block = re.sub(r"(?is)</tr>", "", block)
        block = re.sub(r"(?is)<t[hd][^>]*>", " ", block)
        block = re.sub(r"(?is)</t[hd]>", " | ", block)
        block = re.sub(r"(?is)<[^>]+>", "", block)
        return "\n[표]\n" + block.strip() + "\n"

    h = re.sub(r"(?is)<table[^>]*>.*?</table>", _flatten_table, h)
    h = h.replace("<ul>", "").replace("</ul>", "<br/>")
    h = re.sub(r"(?i)<li[^>]*>", "• ", h)
    h = h.replace("</li>", "<br/>")
    h = re.sub(r"(?i)<ol[^>]*>", "", h)
    h = h.replace("</ol>", "<br/>")
    for level in range(6, 0, -1):
        h = re.sub(rf"(?i)<h{level}[^>]*>", "<b>", h)
        h = re.sub(rf"(?i)</h{level}>", "</b><br/>", h)
    h = h.replace("<p>", "").replace("</p>", "<br/>")
    h = h.replace("<blockquote>", "<i>").replace("</blockquote>", "</i><br/>")
    h = re.sub(r"(?i)<pre[^>]*>", '<font face="Courier">', h)
    h = h.replace("</pre>", "</font><br/>")
    h = h.replace("<code>", '<font face="Courier">').replace("</code>", "</font>")
    h = re.sub(r"(?i)<img[^>]+/?>", "", h)
    h = re.sub(r"(?i)<hr[^>]*/>", "<br/>──<br/>", h)
    h = h.replace("<strong>", "<b>").replace("</strong>", "</b>")
    h = h.replace("<em>", "<i>").replace("</em>", "</i>")
    h = re.sub(r"(<br\s*/>\s*){4,}", "<br/><br/><br/>", h)
    return h.strip()


def _ensure_fonts() -> tuple[str, str]:
    global _FONT_REGULAR, _FONT_BOLD, _FONT_REGISTERED
    if _FONT_REGISTERED:
        return _FONT_REGULAR, _FONT_BOLD

    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfbase.pdfmetrics import registerFontFamily

        reg_path = _FONT_STORAGE_DIR / "NanumGothic.ttf"
        bold_path = _FONT_STORAGE_DIR / "NanumGothicBold.ttf"

        if reg_path.exists() and reg_path.stat().st_size > 10_000:
            try:
                pdfmetrics.registerFont(TTFont("NanumGothic", str(reg_path)))
                bold_name = "NanumGothic"
                if bold_path.exists() and bold_path.stat().st_size > 10_000:
                    pdfmetrics.registerFont(TTFont("NanumGothicBold", str(bold_path)))
                    bold_name = "NanumGothicBold"
                registerFontFamily("NanumGothic", normal="NanumGothic", bold=bold_name,
                                   italic="NanumGothic", boldItalic=bold_name)
                _FONT_REGULAR = "NanumGothic"
                _FONT_BOLD = bold_name
                _FONT_REGISTERED = True
                return _FONT_REGULAR, _FONT_BOLD
            except Exception as exc:
                logger.warning("임시 폰트 디렉터리 등록 실패: %s", exc)

        for reg_name, sys_reg, sys_bold in _SYSTEM_FONT_CANDIDATES:
            if not Path(sys_reg).exists():
                continue
            try:
                pdfmetrics.registerFont(TTFont(reg_name, sys_reg))
            except Exception:
                continue
            bold_name = reg_name
            if sys_bold and Path(sys_bold).exists():
                try:
                    pdfmetrics.registerFont(TTFont(reg_name + "Bold", sys_bold))
                    bold_name = reg_name + "Bold"
                except Exception:
                    pass
            registerFontFamily(reg_name, normal=reg_name, bold=bold_name,
                               italic=reg_name, boldItalic=bold_name)
            _FONT_REGULAR = reg_name
            _FONT_BOLD = bold_name
            _FONT_REGISTERED = True
            logger.info("시스템 폰트 등록: %s (%s)", reg_name, sys_reg)
            return _FONT_REGULAR, _FONT_BOLD

    except Exception as exc:
        logger.warning("폰트 등록 중 예외: %s", exc)

    logger.warning("한글 폰트 없음 — Helvetica 대체 (한글 깨짐)")
    _FONT_REGULAR = "Helvetica"
    _FONT_BOLD = "Helvetica-Bold"
    _FONT_REGISTERED = True
    return _FONT_REGULAR, _FONT_BOLD


def render(
    fields: "MinuteFields",
    *,
    db: Any = None,
    meeting_id: int | None = None,
) -> bytes:
    """ReportLab으로 기본 회의록 PDF를 생성합니다 (Playwright 폴백)."""
    if db is not None and meeting_id is not None:
        from app.domains.action.minutes_pipeline import data_mapper as dm

        fields = dm.enrich_minute_fields_from_db(fields, db, meeting_id)

    try:
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        )
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.colors import black, HexColor
    except ImportError as exc:
        raise ImportError("reportlab이 필요합니다. pip install reportlab") from exc

    font_reg, font_bold = _ensure_fonts()

    A4_W, A4_H = 595.28, 841.89
    MARGIN = 40.0
    CONTENT_W = A4_W - 2 * MARGIN
    GRAY = HexColor("#C0C0C0")

    def _lbl(text: str, size: float = 9.0) -> Paragraph:
        return Paragraph(text, ParagraphStyle(
            "lbl", fontName=font_bold, fontSize=size,
            leading=size * 1.35, textColor=black,
        ))

    def _plain_val(text: str, size: float = 8.5) -> Paragraph:
        esc = html.escape(text or "").replace("\n", "<br/>")
        return Paragraph(
            esc,
            ParagraphStyle(
                "val", fontName=font_reg, fontSize=size,
                leading=size * 1.45, textColor=black, wordWrap="CJK",
            ),
        )

    def _md_val(text: str, size: float = 8.5) -> Paragraph:
        markup = _markdown_to_reportlab_markup(text or "")
        style = ParagraphStyle(
            "valmd", fontName=font_reg, fontSize=size,
            leading=size * 1.45, textColor=black, wordWrap="CJK",
        )
        if not markup:
            return Paragraph("", style)
        try:
            return Paragraph(markup, style)
        except Exception:
            logger.debug("ReportLab Paragraph 마크업 실패, 평문 폴백", exc_info=True)
            return _plain_val(re.sub(r"<[^>]+>", "", markup), size)

    # HTML `.col-lbl`(26mm)과 동일 비율 — ReportLab pt (26mm ≈ 73.7pt)
    LW = 74.0
    RW = CONTENT_W - LW

    # 1. 메타 테이블 — lbl 열(0·2·4)을 모두 LW로 통일, 값 열 너비만 조정
    _m_dt = 120.0   # 회의일시 값
    _m_dept = 50.0  # 부서 값
    mc = [
        LW,
        _m_dt,
        LW,
        _m_dept,
        LW,
        CONTENT_W - LW * 3 - _m_dt - _m_dept,
    ]
    meta = Table([
        [_lbl("회의일시"), _md_val(fields.datetime, 8),
         _lbl("부서"), _md_val(fields.dept, 8),
         _lbl("작성자"), _md_val(fields.author, 8)],
        [_lbl("참석자"), _md_val(fields.attendees, 8), "", "", "", ""],
    ], colWidths=mc, rowHeights=[20, 18])
    meta.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, black),
        ("LINEBELOW", (0, 0), (-1, 0), 0.4, GRAY),
        ("LINEBEFORE", (1, 0), (1, 0), 0.4, GRAY),
        ("LINEBEFORE", (2, 0), (2, 0), 0.4, GRAY),
        ("LINEBEFORE", (3, 0), (3, 0), 0.4, GRAY),
        ("LINEBEFORE", (4, 0), (4, 0), 0.4, GRAY),
        ("LINEBEFORE", (5, 0), (5, 0), 0.4, GRAY),
        ("SPAN", (1, 1), (5, 1)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))

    def _section(col_widths: list, rows: list, extra: list | None = None) -> Table:
        t = Table(rows, colWidths=col_widths)
        cmds = [
            ("LINEABOVE", (0, 0), (-1, 0), 0.75, black),
            ("LINEBELOW", (0, -1), (-1, -1), 0.4, GRAY),
            ("LINEBEFORE", (0, 0), (0, -1), 0.4, GRAY),
            ("LINEAFTER", (-1, 0), (-1, -1), 0.4, GRAY),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        if extra:
            cmds.extend(extra)
        t.setStyle(TableStyle(cmds))
        return t

    # 2. 회의안건
    agenda = _section([LW, RW], [[_lbl("회의안건"), _md_val(fields.agenda_items)]], extra=[
        ("LINEBEFORE", (1, 0), (1, -1), 0.4, GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (1, 0), (1, -1), 40),
    ])

    # 3. 회의내용 (별도 비고 DB·필드 없음 — 회의안건과 동일 2열)
    content_tbl = _section([LW, RW], [[_lbl("회의내용"), _md_val(fields.discussion_content)]], extra=[
        ("LINEBEFORE", (1, 0), (1, -1), 0.4, GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (1, 0), (1, -1), 50),
    ])

    # 4. 결정사항 (decisions 테이블에 진행일정 컬럼 없음 — 내용 열만)
    dec_lines = [r for r in fields.decision_rows if r.strip()]
    n_rows = max(3, len(dec_lines))
    dec_data = [[_lbl("결정사항"), _lbl("내용", 8)]]
    _dec_row_h = 26.0
    for i in range(n_rows):
        line = dec_lines[i] if i < len(dec_lines) else ""
        if (line or "").strip():
            dec_data.append(["", _md_val(line)])
        else:
            dec_data.append(["", _plain_val("\u00a0")])
    n = len(dec_data) - 1
    dec_cmds = [
        ("LINEABOVE", (0, 0), (-1, 0), 0.75, black),
        ("LINEBELOW", (0, -1), (-1, -1), 0.4, GRAY),
        ("LINEBEFORE", (0, 0), (0, -1), 0.4, GRAY),
        ("LINEAFTER", (-1, 0), (-1, -1), 0.4, GRAY),
        ("LINEBEFORE", (1, 0), (1, -1), 0.4, GRAY),
        ("LINEBELOW", (1, 0), (1, 0), 0.4, GRAY),
        ("SPAN", (0, 0), (0, n)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for r in range(1, n + 1):
        dec_cmds.append(("LINEBELOW", (1, r), (1, r), 0.4, GRAY))
    dec = Table(
        dec_data,
        colWidths=[LW, RW],
        rowHeights=[16] + [_dec_row_h] * n,
    )
    dec.setStyle(TableStyle(dec_cmds))

    # 5. 액션 아이템 (결정사항과 동일 row 구조 · pdf_renderer.action_rows와 동일)
    _am_re = re.compile(r"^(\s*)[-*+] ")

    def _strip_action_list_markers(text: str) -> str:
        return "\n".join(
            _am_re.sub(r"\1", line) for line in (text or "").split("\n")
        )

    _action_lines = [
        r
        for r in _strip_action_list_markers(fields.action_items or "").split("\n")
        if (r or "").strip()
    ]
    while len(_action_lines) < 3:
        _action_lines.append("")
    action_data = [[_lbl("액션 아이템"), _lbl("내용", 8)]]
    for line in _action_lines:
        if (line or "").strip():
            action_data.append(["", _md_val(line)])
        else:
            action_data.append(["", _plain_val("\u00a0")])
    n_act = len(action_data) - 1
    action_cmds = [
        ("LINEABOVE", (0, 0), (-1, 0), 0.75, black),
        ("LINEBELOW", (0, -1), (-1, -1), 0.4, GRAY),
        ("LINEBEFORE", (0, 0), (0, -1), 0.4, GRAY),
        ("LINEAFTER", (-1, 0), (-1, -1), 0.4, GRAY),
        ("LINEBEFORE", (1, 0), (1, -1), 0.4, GRAY),
        ("LINEBELOW", (1, 0), (1, 0), 0.4, GRAY),
        ("SPAN", (0, 0), (0, n_act)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for r in range(1, n_act + 1):
        action_cmds.append(("LINEBELOW", (1, r), (1, r), 0.4, GRAY))
    action = Table(
        action_data,
        colWidths=[LW, RW],
        rowHeights=[16] + [_dec_row_h] * n_act,
    )
    action.setStyle(TableStyle(action_cmds))

    # 6. 특이사항
    notes = _section([LW, RW], [[_lbl("특이사항"), _md_val(fields.special_notes)]], extra=[
        ("LINEBEFORE", (1, 0), (1, -1), 0.4, GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (1, 0), (1, -1), 60),
    ])

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=(A4_W, A4_H),
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    doc.build([
        Paragraph("회의록", ParagraphStyle(
            "title", fontName=font_bold, fontSize=24, leading=32, textColor=black,
        )),
        Spacer(1, 14),
        meta,
        Spacer(1, 8),
        agenda,
        Spacer(1, 8),
        content_tbl,
        Spacer(1, 8),
        dec,
        Spacer(1, 8),
        action,
        Spacer(1, 8),
        notes,
    ])
    buf.seek(0)
    return buf.read()
