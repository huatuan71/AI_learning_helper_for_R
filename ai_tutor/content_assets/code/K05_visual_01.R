# UTF-8 is needed for Chinese labels. This fallback supports Windows C locales.
if (!l10n_info()[["UTF-8"]]) {
  invisible(Sys.setlocale("LC_CTYPE", "English_United States.utf8"))
}
# Run from the code directory. An optional argument selects the output directory.
# Without an argument, the image is written into R's temporary directory.
args <- commandArgs(trailingOnly = TRUE)
output_dir <- if (length(args) > 0L) args[[1L]] else tempdir()
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
svg_lines <- c(
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"720\" height=\"970\" viewBox=\"0 0 720 970\" role=\"img\" aria-labelledby=\"title desc\">",
  "<title id=\"title\">K05 逻辑掩码与成绩逐项对应</title>",
  "<desc id=\"desc\">五行对应表。55、60、NA、90、100分别对应FALSE、TRUE、FALSE、FALSE、FALSE。条件为非缺失且大于等于60并小于90，最终选中60。</desc>",
  "<defs><marker id=\"arrow\" markerWidth=\"10\" markerHeight=\"10\" refX=\"7\" refY=\"4\" orient=\"auto\"><path d=\"M0,0 L8,4 L0,8\" fill=\"none\" stroke=\"#79bdf1\" stroke-width=\"1.5\"/></marker></defs>",
  "<rect width=\"720\" height=\"970\" rx=\"20\" fill=\"#030813\"/>",
  "<g font-family=\"Microsoft YaHei, Noto Sans CJK SC, sans-serif\" fill=\"#b7c5d4\">",
  "<text x=\"36\" y=\"62\" font-size=\"32\" font-weight=\"700\" fill=\"#f5f9ff\">K05 逻辑掩码与成绩逐项对应</text>",
  "<rect x=\"36\" y=\"106\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"147\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">位置 1　55 分</text>",
  "<text x=\"58\" y=\"191\" font-size=\"27\" fill=\"#b7c5d4\">FALSE　未达到 60</text>",
  "<rect x=\"36\" y=\"254\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"295\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">位置 2　60 分</text>",
  "<text x=\"58\" y=\"339\" font-size=\"27\" fill=\"#b7c5d4\">TRUE　保留</text>",
  "<rect x=\"36\" y=\"402\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"443\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">位置 3　NA</text>",
  "<text x=\"58\" y=\"487\" font-size=\"27\" fill=\"#b7c5d4\">FALSE　缺失项</text>",
  "<rect x=\"36\" y=\"550\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"591\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">位置 4　90 分</text>",
  "<text x=\"58\" y=\"635\" font-size=\"27\" fill=\"#b7c5d4\">FALSE　达到上界，本题排除</text>",
  "<rect x=\"36\" y=\"698\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"739\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">位置 5　100 分</text>",
  "<text x=\"58\" y=\"783\" font-size=\"27\" fill=\"#b7c5d4\">FALSE　超出本题区间</text>",
  "<text x=\"36\" y=\"905\" font-size=\"27\" fill=\"#9eafc2\">每个逻辑值控制原向量同一位置的元素。</text>",
  "</g>",
  "</svg>"
)
output_file <- file.path(output_dir, "K05_visual_01.svg")
writeLines(enc2utf8(svg_lines), output_file, useBytes = TRUE)
cat("Generated K05_visual_01.svg\n")
