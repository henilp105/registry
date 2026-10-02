import React, { useMemo, useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/**
 * Rating distribution for a package: how many 1-star through 5-star ratings
 * it has.
 *
 * Recharts draws into SVG with presentation attributes, so a `fill` prop
 * cannot read a CSS variable - it has to be a real colour string. The token
 * value is read once from the computed style of :root so the chart still
 * follows the theme, rather than hard-coding one hex for both themes.
 */
const readToken = (token, fallback) => {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(token).trim() ||
    fallback
  );
};

const useTokenColor = (token, fallback) => {
  const [color, setColor] = useState(() => readToken(token, fallback));

  useEffect(() => {
    setColor(readToken(token, fallback));
    // The theme toggle writes data-theme onto <html>; re-read the token when
    // that changes, otherwise the bars keep the colour of the old theme.
    const observer = new MutationObserver(() =>
      setColor(readToken(token, fallback))
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [token, fallback]);

  return color;
};

const PackageRatingGraph = ({ data }) => {
  const parsedArray = useMemo(
    () =>
      Object.entries(data || {}).map(([key, value]) => ({
        name: `${key} star${key === "1" ? "" : "s"}`,
        star: value,
      })),
    [data]
  );

  // The fallbacks are the light-theme token values, used only if
  // getComputedStyle returns nothing (server render, or an exotic host). They
  // are not theme colours in their own right: in a browser the token always
  // wins, which is the point of reading it rather than hard-coding a fill.
  const barFill = useTokenColor("--color-brand-solid", "#5b53c0");
  const gridColor = useTokenColor("--color-border-subtle", "#e1e2ec");
  const axisColor = useTokenColor("--color-text-muted", "#4b4c5a");

  if (parsedArray.length === 0) {
    return (
      <p className="text-muted">
        No stats available right now. This will update as soon as the package
        gets rated.
      </p>
    );
  }

  return (
    // ResponsiveContainer needs a parent with a definite height; the wrapper
    // provides it. The previous fixed width={600} overflowed the column on
    // narrow screens.
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={parsedArray} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="name"
            stroke={axisColor}
            tick={{ fill: axisColor, fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            stroke={axisColor}
            tick={{ fill: axisColor, fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: gridColor }}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text)",
            }}
          />
          <Bar dataKey="star" fill={barFill} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PackageRatingGraph;
