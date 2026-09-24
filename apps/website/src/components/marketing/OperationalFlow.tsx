/**
 * Static operational lifecycle model.
 */
export function OperationalFlow() {
  const stages = [
    ["Activate", "Start the emergency workflow"],
    ["Establish Context", "Identity, authority and location"],
    ["Coordinate", "Connect authorized teams and incident context"],
    ["Preserve", "Maintain closure, evidence and accountability"],
  ] as const;

  return (
    <figure className="m-hero-diagram">
      <figcaption className="m-flow-caption">
        <span className="m-eyebrow">OPA Operational Lifecycle</span>
        <strong>From activation to accountability.</strong>
      </figcaption>

      <ol
        className="m-operational-flow"
        aria-label="Activate, establish context, coordinate, preserve"
      >
        {stages.map(([stage, description]) => (
          <li key={stage}>
            <div>
              <strong>{stage}</strong>
            </div>
            <p>{description}</p>
          </li>
        ))}
      </ol>
    </figure>
  );
}
