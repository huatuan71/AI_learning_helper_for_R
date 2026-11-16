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
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"720\" height=\"674\" viewBox=\"0 0 720 674\" role=\"img\" aria-labelledby=\"title desc\">",
  "<title id=\"title\">K07 因子水平、标签和内部编码</title>",
  "<desc id=\"desc\">三行映射。原始值low、mid、high按显式levels依次对应显示标签Low、Mid、High和内部编码1、2、3。有序因子的次序为Low小于Mid小于High。</desc>",
  "<defs><marker id=\"arrow\" markerWidth=\"10\" markerHeight=\"10\" refX=\"7\" refY=\"4\" orient=\"auto\"><path d=\"M0,0 L8,4 L0,8\" fill=\"none\" stroke=\"#79bdf1\" stroke-width=\"1.5\"/></marker></defs>",
  "<rect width=\"720\" height=\"674\" rx=\"20\" fill=\"#030813\"/>",
  "<g font-family=\"Microsoft YaHei, Noto Sans CJK SC, sans-serif\" fill=\"#b7c5d4\">",
  "<text x=\"36\" y=\"62\" font-size=\"32\" font-weight=\"700\" fill=\"#f5f9ff\">K07 因子水平、标签和内部编码</text>",
  "<rect x=\"36\" y=\"106\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"147\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">原始值 low</text>",
  "<text x=\"58\" y=\"191\" font-size=\"27\" fill=\"#b7c5d4\">标签 Low　内部编码 1</text>",
  "<rect x=\"36\" y=\"254\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"295\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">原始值 mid</text>",
  "<text x=\"58\" y=\"339\" font-size=\"27\" fill=\"#b7c5d4\">标签 Mid　内部编码 2</text>",
  "<rect x=\"36\" y=\"402\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"443\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">原始值 high</text>",
  "<text x=\"58\" y=\"487\" font-size=\"27\" fill=\"#b7c5d4\">标签 High　内部编码 3</text>",
  "<text x=\"36\" y=\"609\" font-size=\"27\" fill=\"#9eafc2\">有序关系为 Low &lt; Mid &lt; High。</text>",
  "</g>",
  "</svg>"
)
output_file <- file.path(output_dir, "K07_visual_01.svg")
writeLines(enc2utf8(svg_lines), output_file, useBytes = TRUE)
cat("Generated K07_visual_01.svg\n")
