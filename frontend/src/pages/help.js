import React from "react";
import "./help.css";

/*
 * The four sections are data rather than markup: three of them are the same
 * shape (title, intro, list of steps) and were previously three near-identical
 * blocks of divs. One list, one renderer.
 */
const SECTIONS = [
  {
    id: "account-registration",
    title: "Account Registration",
    intro:
      "To publish packages to the registry, you first need to register an account:",
    steps: [
      <>
        <strong className="help__highlight">Create an account</strong> with a
        unique username, valid email, and secure password
      </>,
      <>Verify your email address to activate your account</>,
      <>Login to access your personal dashboard</>,
    ],
  },
  {
    id: "namespace-creation",
    title: "Namespace Creation",
    intro:
      "Before uploading packages, create a namespace to organize your packages:",
    steps: [
      <>
        Create a <strong className="help__highlight">globally unique
        namespace</strong> through your dashboard
      </>,
      <>Namespaces prevent package naming collisions across users</>,
      <>Add a descriptive name and meaningful description</>,
    ],
  },
  {
    id: "token-management",
    title: "Token Management",
    intro: "Generate authentication tokens for secure package uploads:",
    steps: [
      <>Access namespace tokens through your dashboard</>,
      <>
        Tokens expire after{" "}
        <strong className="help__highlight">7 days</strong> by default
      </>,
      <>Regenerate tokens anytime with one click</>,
      <>Revoke tokens immediately if compromised</>,
    ],
  },
  {
    id: "package-upload",
    title: "Package Upload Process",
    intro: "Publish packages using the fpm CLI with your token:",
    code: "fpm publish --token [your-generated-token]",
    steps: [
      <>Successful uploads will appear instantly in your dashboard</>,
      <>CLI provides immediate feedback on upload status</>,
    ],
  },
  {
    id: "package-management",
    title: "Package Management",
    intro: "After successful upload, manage your packages through the dashboard:",
    steps: [
      <>
        <strong>Maintainers:</strong> Add/remove maintainers with full
        management privileges
      </>,
      <>
        <strong>Visibility:</strong> Control package visibility
        (public/private)
      </>,
      <>
        <strong>Metadata:</strong> Edit package descriptions and documentation
      </>,
      <>
        <strong>Versions:</strong> Manage multiple package versions
      </>,
      <>
        <strong>Statistics:</strong> View download metrics and usage statistics
      </>,
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    steps: [
      <>
        <strong>Upload failed?</strong> Check token validity and namespace
        permissions
      </>,
      <>
        <strong>Package not appearing?</strong> Allow up to 60 seconds for
        processing
      </>,
      <>
        <strong>CLI errors?</strong> Ensure you&apos;re using fpm version 0.8.0
        or newer
      </>,
    ],
  },
];

/** A titled section with an optional intro, an optional code sample and a
 *  list of steps. The <ul>/<li> is what a screen reader announces; the bullet
 *  is drawn in CSS (.help__step::before) rather than by a positioned <div>. */
const HelpSection = ({ title, intro, code, steps }) => (
  <section aria-labelledby={`help-${title.toLowerCase().replace(/\s+/g, "-")}`}>
    <h2
      className="help__section-title"
      id={`help-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {title}
    </h2>
    {intro && <p className="help__body">{intro}</p>}
    {code && <pre className="help__code">{code}</pre>}
    <ul className="help__steps">
      {steps.map((step, i) => (
        <li className="help__step" key={i}>
          {step}
        </li>
      ))}
    </ul>
  </section>
);

const Help = () => (
  <main className="help">
    <h1 className="help__title">Package Registry Help Guide</h1>

    {/* Two columns on wide screens, one on narrow. The sections are grouped
        so the reading order matches the visual order. */}
    <div className="help__layout">
      <div className="help__column">
        {SECTIONS.slice(0, 2).map((section) => (
          <HelpSection key={section.id} {...section} />
        ))}
      </div>
      <div className="help__column">
        {SECTIONS.slice(2, 4).map((section) => (
          <HelpSection key={section.id} {...section} />
        ))}
      </div>
    </div>

    {SECTIONS.slice(4).map((section) => (
      <HelpSection key={section.id} {...section} />
    ))}
  </main>
);

export default Help;
