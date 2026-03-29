type CityCardEntry = {
  label: string;
  searchValue: string;
  icon: React.ReactNode;
};

function GoldenGateBridge() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      {/* left tower */}
      <rect x="15" y="10" width="3" height="36" fill="#C4342D" opacity="0.35" />
      <rect x="20" y="10" width="3" height="36" fill="#C4342D" opacity="0.35" />
      <rect x="15" y="8" width="8" height="3" rx="0.5" fill="#C4342D" opacity="0.4" />
      <rect x="15" y="18" width="8" height="2" fill="#C4342D" opacity="0.2" />
      <rect x="15" y="26" width="8" height="2" fill="#C4342D" opacity="0.2" />
      {/* right tower */}
      <rect x="41" y="10" width="3" height="36" fill="#C4342D" opacity="0.35" />
      <rect x="46" y="10" width="3" height="36" fill="#C4342D" opacity="0.35" />
      <rect x="41" y="8" width="8" height="3" rx="0.5" fill="#C4342D" opacity="0.4" />
      <rect x="41" y="18" width="8" height="2" fill="#C4342D" opacity="0.2" />
      <rect x="41" y="26" width="8" height="2" fill="#C4342D" opacity="0.2" />
      {/* main catenary cables */}
      <path d="M2 14C2 14 8 12 19 10" stroke="#C4342D" strokeWidth="2" opacity="0.35" strokeLinecap="round" />
      <path d="M19 10C24 18 28 32 32 34C36 32 40 18 45 10" stroke="#C4342D" strokeWidth="2" opacity="0.35" />
      <path d="M45 10C56 12 62 14 62 14" stroke="#C4342D" strokeWidth="2" opacity="0.35" strokeLinecap="round" />
      {/* road deck */}
      <rect x="4" y="34" width="56" height="2.5" rx="0.5" fill="#C4342D" opacity="0.25" />
      {/* vertical suspender cables */}
      <line x1="24" y1="16" x2="24" y2="34" stroke="#C4342D" strokeWidth="0.8" opacity="0.18" />
      <line x1="28" y1="24" x2="28" y2="34" stroke="#C4342D" strokeWidth="0.8" opacity="0.18" />
      <line x1="32" y1="34" x2="32" y2="34" stroke="#C4342D" strokeWidth="0.8" opacity="0.18" />
      <line x1="36" y1="24" x2="36" y2="34" stroke="#C4342D" strokeWidth="0.8" opacity="0.18" />
      <line x1="40" y1="16" x2="40" y2="34" stroke="#C4342D" strokeWidth="0.8" opacity="0.18" />
      {/* water waves */}
      <path d="M4 48C8 46 12 48 16 46C20 44 24 46 28 44C32 42 36 44 40 42C44 40 48 42 52 40C56 38 60 40 62 39" stroke="#C4342D" strokeWidth="2" opacity="0.15" strokeLinecap="round" />
      <path d="M4 53C8 51 12 53 16 51C20 49 24 51 28 49C32 47 36 49 40 47C44 45 48 47 52 45C56 43 60 45 62 44" stroke="#C4342D" strokeWidth="1.5" opacity="0.1" strokeLinecap="round" />
    </svg>
  );
}

function EmpireState() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      {/* antenna spire */}
      <line x1="32" y1="4" x2="32" y2="14" stroke="#C4342D" strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />
      {/* crown/top */}
      <path d="M29 14H35L34 18H30L29 14Z" fill="#C4342D" opacity="0.35" />
      {/* upper tower */}
      <rect x="28" y="18" width="8" height="12" rx="1" fill="#C4342D" opacity="0.3" />
      {/* setback */}
      <rect x="25" y="30" width="14" height="4" rx="1" fill="#C4342D" opacity="0.25" />
      {/* main body */}
      <rect x="22" y="34" width="20" height="16" rx="1" fill="#C4342D" opacity="0.22" />
      {/* base */}
      <rect x="20" y="50" width="24" height="4" rx="1" fill="#C4342D" opacity="0.15" />
      {/* windows */}
      <line x1="27" y1="36" x2="27" y2="50" stroke="#C4342D" strokeWidth="0.8" opacity="0.12" />
      <line x1="32" y1="36" x2="32" y2="50" stroke="#C4342D" strokeWidth="0.8" opacity="0.12" />
      <line x1="37" y1="36" x2="37" y2="50" stroke="#C4342D" strokeWidth="0.8" opacity="0.12" />
      <line x1="22" y1="40" x2="42" y2="40" stroke="#C4342D" strokeWidth="0.6" opacity="0.1" />
      <line x1="22" y1="45" x2="42" y2="45" stroke="#C4342D" strokeWidth="0.6" opacity="0.1" />
    </svg>
  );
}

function FilmReel() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      {/* clapperboard top */}
      <path d="M12 18L52 18L48 10H16L12 18Z" fill="#C4342D" opacity="0.3" />
      {/* clapper stripes */}
      <line x1="20" y1="10.5" x2="16" y2="17.5" stroke="#C4342D" strokeWidth="2" opacity="0.2" />
      <line x1="28" y1="10.5" x2="24" y2="17.5" stroke="#C4342D" strokeWidth="2" opacity="0.2" />
      <line x1="36" y1="10.5" x2="32" y2="17.5" stroke="#C4342D" strokeWidth="2" opacity="0.2" />
      <line x1="44" y1="10.5" x2="40" y2="17.5" stroke="#C4342D" strokeWidth="2" opacity="0.2" />
      {/* board body */}
      <rect x="12" y="18" width="40" height="28" rx="2" fill="#C4342D" opacity="0.18" />
      {/* text lines */}
      <line x1="18" y1="26" x2="36" y2="26" stroke="#C4342D" strokeWidth="2" opacity="0.15" strokeLinecap="round" />
      <line x1="18" y1="32" x2="30" y2="32" stroke="#C4342D" strokeWidth="2" opacity="0.12" strokeLinecap="round" />
      <line x1="18" y1="38" x2="34" y2="38" stroke="#C4342D" strokeWidth="2" opacity="0.12" strokeLinecap="round" />
      {/* star */}
      <path d="M44 32L45.5 35H49L46 37.5L47 41L44 39L41 41L42 37.5L39 35H42.5L44 32Z" fill="#C4342D" opacity="0.25" />
    </svg>
  );
}

function Skyline() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <rect x="8" y="30" width="8" height="22" rx="1" fill="#C4342D" opacity="0.2" />
      <rect x="18" y="22" width="7" height="30" rx="1" fill="#C4342D" opacity="0.25" />
      <rect x="27" y="14" width="10" height="38" rx="1" fill="#C4342D" opacity="0.3" />
      <rect x="39" y="26" width="8" height="26" rx="1" fill="#C4342D" opacity="0.2" />
      <rect x="49" y="34" width="7" height="18" rx="1" fill="#C4342D" opacity="0.18" />
      <rect x="30" y="10" width="4" height="6" rx="1" fill="#C4342D" opacity="0.35" />
    </svg>
  );
}

function Beach() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      {/* sun */}
      <circle cx="48" cy="14" r="7" fill="#C4342D" opacity="0.15" />
      <circle cx="48" cy="14" r="4" fill="#C4342D" opacity="0.12" />
      {/* palm trunk */}
      <path d="M18 50C20 38 22 30 24 24" stroke="#C4342D" strokeWidth="2.5" opacity="0.25" strokeLinecap="round" />
      {/* palm fronds */}
      <path d="M24 24C18 18 10 18 8 20" stroke="#C4342D" strokeWidth="2" opacity="0.28" strokeLinecap="round" />
      <path d="M24 24C30 18 38 20 40 22" stroke="#C4342D" strokeWidth="2" opacity="0.28" strokeLinecap="round" />
      <path d="M24 22C20 14 12 14 10 16" stroke="#C4342D" strokeWidth="1.5" opacity="0.22" strokeLinecap="round" />
      <path d="M24 22C28 16 36 16 38 18" stroke="#C4342D" strokeWidth="1.5" opacity="0.22" strokeLinecap="round" />
      {/* waves */}
      <path d="M4 44C10 42 16 44 22 42C28 40 34 42 40 40C46 38 52 40 60 38" stroke="#C4342D" strokeWidth="2" opacity="0.15" strokeLinecap="round" />
      <path d="M4 50C10 48 16 50 22 48C28 46 34 48 40 46C46 44 52 46 60 44" stroke="#C4342D" strokeWidth="1.5" opacity="0.1" strokeLinecap="round" />
    </svg>
  );
}

function GuitarStar() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <path d="M32 8L34.5 18H44L36.5 24L39 34L32 28L25 34L27.5 24L20 18H29.5L32 8Z" fill="#C4342D" opacity="0.2" />
      <path d="M32 8L34.5 18H44L36.5 24L39 34L32 28L25 34L27.5 24L20 18H29.5L32 8Z" stroke="#C4342D" strokeWidth="1.5" opacity="0.3" />
      <rect x="28" y="36" width="8" height="16" rx="3" fill="#C4342D" opacity="0.15" />
      <line x1="32" y1="38" x2="32" y2="50" stroke="#C4342D" strokeWidth="1" opacity="0.2" />
    </svg>
  );
}

function SpaceNeedle() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <rect x="30.5" y="24" width="3" height="28" rx="1" fill="#C4342D" opacity="0.2" />
      <rect x="26" y="50" width="12" height="3" rx="1" fill="#C4342D" opacity="0.15" />
      <ellipse cx="32" cy="22" rx="14" ry="3" fill="#C4342D" opacity="0.2" />
      <rect x="29" y="14" width="6" height="8" rx="2" fill="#C4342D" opacity="0.3" />
      <rect x="31" y="10" width="2" height="6" rx="1" fill="#C4342D" opacity="0.35" />
    </svg>
  );
}

function ToriiGate() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <rect x="16" y="22" width="4" height="30" rx="1" fill="#C4342D" opacity="0.25" />
      <rect x="44" y="22" width="4" height="30" rx="1" fill="#C4342D" opacity="0.25" />
      <rect x="12" y="18" width="40" height="4" rx="1" fill="#C4342D" opacity="0.3" />
      <path d="M10 18C10 18 20 12 32 12C44 12 54 18 54 18" stroke="#C4342D" strokeWidth="3" opacity="0.35" strokeLinecap="round" />
      <rect x="14" y="28" width="36" height="2.5" rx="1" fill="#C4342D" opacity="0.18" />
    </svg>
  );
}

function BigBen() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <rect x="24" y="20" width="16" height="32" rx="1" fill="#C4342D" opacity="0.2" />
      <rect x="27" y="12" width="10" height="10" rx="1" fill="#C4342D" opacity="0.28" />
      <path d="M30 12L32 6L34 12" fill="#C4342D" opacity="0.35" />
      <circle cx="32" cy="17" r="3" stroke="#C4342D" strokeWidth="1.5" opacity="0.3" fill="none" />
      <rect x="22" y="50" width="20" height="3" rx="1" fill="#C4342D" opacity="0.15" />
      <line x1="32" y1="15" x2="32" y2="18" stroke="#C4342D" strokeWidth="1" opacity="0.3" />
      <line x1="32" y1="17" x2="34" y2="17" stroke="#C4342D" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

function EiffelTower() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <path d="M32 8L20 52H44L32 8Z" fill="#C4342D" opacity="0.15" />
      <path d="M32 8L20 52" stroke="#C4342D" strokeWidth="2" opacity="0.3" />
      <path d="M32 8L44 52" stroke="#C4342D" strokeWidth="2" opacity="0.3" />
      <line x1="23" y1="36" x2="41" y2="36" stroke="#C4342D" strokeWidth="2" opacity="0.25" />
      <line x1="26" y1="26" x2="38" y2="26" stroke="#C4342D" strokeWidth="1.5" opacity="0.2" />
      <rect x="18" y="50" width="28" height="3" rx="1" fill="#C4342D" opacity="0.12" />
    </svg>
  );
}

function SagradaFamilia() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <rect x="14" y="24" width="6" height="28" rx="1" fill="#C4342D" opacity="0.2" />
      <rect x="25" y="20" width="6" height="32" rx="1" fill="#C4342D" opacity="0.22" />
      <rect x="34" y="18" width="6" height="34" rx="1" fill="#C4342D" opacity="0.25" />
      <rect x="45" y="24" width="6" height="28" rx="1" fill="#C4342D" opacity="0.2" />
      <path d="M17 24L17 16" stroke="#C4342D" strokeWidth="2" opacity="0.35" strokeLinecap="round" />
      <path d="M28 20L28 12" stroke="#C4342D" strokeWidth="2" opacity="0.35" strokeLinecap="round" />
      <path d="M37 18L37 8" stroke="#C4342D" strokeWidth="2" opacity="0.35" strokeLinecap="round" />
      <path d="M48 24L48 16" stroke="#C4342D" strokeWidth="2" opacity="0.35" strokeLinecap="round" />
      <circle cx="17" cy="14" r="2" fill="#C4342D" opacity="0.25" />
      <circle cx="28" cy="10" r="2" fill="#C4342D" opacity="0.25" />
      <circle cx="37" cy="6" r="2" fill="#C4342D" opacity="0.3" />
      <circle cx="48" cy="14" r="2" fill="#C4342D" opacity="0.25" />
    </svg>
  );
}

function Pyramid() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <path d="M32 12L50 50H14L32 12Z" fill="#C4342D" opacity="0.18" />
      <path d="M32 12L50 50H14L32 12Z" stroke="#C4342D" strokeWidth="2" opacity="0.3" />
      <path d="M32 12L38 50" stroke="#C4342D" strokeWidth="1" opacity="0.15" />
      <line x1="20" y1="36" x2="44" y2="36" stroke="#C4342D" strokeWidth="1" opacity="0.15" />
      <line x1="17" y1="43" x2="47" y2="43" stroke="#C4342D" strokeWidth="1" opacity="0.12" />
      <circle cx="46" cy="14" r="5" fill="#C4342D" opacity="0.12" />
    </svg>
  );
}

const FEATURED_CITIES: CityCardEntry[] = [
  { label: "San Francisco", searchValue: "San Francisco, CA", icon: <GoldenGateBridge /> },
  { label: "New York", searchValue: "New York, NY", icon: <EmpireState /> },
  { label: "Los Angeles", searchValue: "Los Angeles, CA", icon: <FilmReel /> },
  { label: "Chicago", searchValue: "Chicago, IL", icon: <Skyline /> },
  { label: "Miami", searchValue: "Miami, FL", icon: <Beach /> },
  { label: "Austin", searchValue: "Austin, TX", icon: <GuitarStar /> },
  { label: "Tokyo", searchValue: "Tokyo, Japan", icon: <ToriiGate /> },
  { label: "London", searchValue: "London, UK", icon: <BigBen /> },
  { label: "Paris", searchValue: "Paris, France", icon: <EiffelTower /> },
  { label: "Barcelona", searchValue: "Barcelona, Spain", icon: <SagradaFamilia /> },
  { label: "Seattle", searchValue: "Seattle, WA", icon: <SpaceNeedle /> },
  { label: "Mexico City", searchValue: "Mexico City, Mexico", icon: <Pyramid /> },
];

type CityCardsProps = {
  onCitySelect: (city: string) => void;
};

export function CityCards({ onCitySelect }: CityCardsProps) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-[#8A7060]">Explore a city</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {FEATURED_CITIES.map((city) => (
          <button
            key={city.searchValue}
            type="button"
            onClick={() => onCitySelect(city.searchValue)}
            className="group flex flex-col items-center gap-2 rounded-xl border border-[#E8DAD0] bg-white px-3 py-4 transition-all hover:border-[#C4342D]/30 hover:shadow-sm active:scale-[0.98]"
          >
            <span className="transition-transform group-hover:scale-105">{city.icon}</span>
            <span className="text-[13px] font-medium text-[#4A3728]">{city.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
