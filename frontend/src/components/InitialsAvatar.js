import React from "react";
import "./InitialsAvatar.css";

/**
 * Deterministic local avatar.
 *
 * This replaces `https://www.gravatar.com/avatar/${username}?...`, which keyed
 * Gravatar on the *username* rather than the MD5 of the user's email — so it
 * always missed and silently fell back to the identicon while making a
 * third-party request on every profile view. Initials derived from the name we
 * already render are deterministic, work offline, and leak nothing.
 */
const InitialsAvatar = ({ name, className = "", size }) => {
  const label = (name || "?").trim();
  const initials = label
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

  return (
    <div
      className={`initials-avatar ${className}`.trim()}
      role="img"
      aria-label={`Avatar for ${label}`}
      style={size ? { width: size, height: size, fontSize: size / 3 } : undefined}
    >
      {initials}
    </div>
  );
};

export default InitialsAvatar;
