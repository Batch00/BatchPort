// Whether the viewer has asked for less animation.
//
// Client-only by nature: there is no media query to ask on the server, and the
// honest answer there is "assume reduced", so nothing schedules an animation
// before hydration has had a chance to check.

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
