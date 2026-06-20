import BlindSpotDemo from './BlindSpotDemo';
import ReverseParkingDemo from './ReverseParkingDemo';

// Registry of interactive canvases. Each entry: a URL slug, a sidebar title,
// and the React component that renders the canvas. Add new canvases here.
export const canvases = [
  {
    slug: 'blind-spot',
    title: "How A Car's Blind Spot Forms",
    icon: 'car',
    Component: BlindSpotDemo,
  },
  {
    slug: 'reverse-parking',
    title: 'Head-In vs. Reverse Parking',
    icon: 'car',
    Component: ReverseParkingDemo,
  },
];
