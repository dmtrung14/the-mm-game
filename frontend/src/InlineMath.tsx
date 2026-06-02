import katex from "katex";
import "katex/dist/katex.min.css";

type Props = {
  math: string;
};

export function InlineMath({ math }: Props) {
  const html = katex.renderToString(math, {
    throwOnError: false,
    displayMode: false,
  });

  return (
    <span
      className="inline-math mx-0.5 align-baseline [&_.katex]:text-[0.95em]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
