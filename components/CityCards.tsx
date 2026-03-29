type CityCardEntry = {
  label: string;
  searchValue: string;
  icon: React.ReactNode;
};

function GoldenGate() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <rect x="10" y="20" width="4" height="30" rx="1" fill="#C4342D" opacity="0.25" />
      <rect x="50" y="20" width="4" height="30" rx="1" fill="#C4342D" opacity="0.25" />
      <rect x="10" y="18" width="4" height="6" rx="1" fill="#C4342D" opacity="0.4" />
      <rect x="50" y="18" width="4" height="6" rx="1" fill="#C4342D" opacity="0.4" />
      <path d="M12 22C12 22 22 16 32 16C42 16 52 22 52 22" stroke="#C4342D" strokeWidth="2.5" opacity="0.35" />
      <path d="M12 27C12 27 22 21 32 21C42 21 52 27 52 27" stroke="#C4342D" strokeWidth="1.5" opacity="0.2" />
      <line x1="8" y1="50" x2="56" y2="50" stroke="#C4342D" strokeWidth="2" opacity="0.15" />
    </svg>
  );
}

function StatueOfLiberty() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <rect x="28" y="28" width="8" height="22" rx="2" fill="#C4342D" opacity="0.2" />
      <rect x="26" y="48" width="12" height="4" rx="1" fill="#C4342D" opacity="0.15" />
      <path d="M32 28V18" stroke="#C4342D" strokeWidth="2.5" opacity="0.35" strokeLinecap="round" />
      <circle cx="32" cy="24" r="5" fill="#C4342D" opacity="0.18" />
      <path d="M27 18L32 10L37 18" fill="#C4342D" opacity="0.25" />
      <path d="M29 14L25 8M32 12L32 5M35 14L39 8" stroke="#C4342D" strokeWidth="1.5" opacity="0.3" strokeLinecap="round" />
    </svg>
  );
}

function PalmTree() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <path d="M32 52V24" stroke="#C4342D" strokeWidth="2.5" opacity="0.25" strokeLinecap="round" />
      <path d="M32 24C26 18 18 18 14 20" stroke="#C4342D" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
      <path d="M32 24C38 18 46 18 50 20" stroke="#C4342D" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
      <path d="M32 22C28 14 20 12 16 14" stroke="#C4342D" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
      <path d="M32 22C36 14 44 12 48 14" stroke="#C4342D" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
      <path d="M32 20C30 12 32 8 32 8" stroke="#C4342D" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
      <ellipse cx="32" cy="52" rx="10" ry="2" fill="#C4342D" opacity="0.1" />
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

function BeachUmbrella() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <path d="M32 22V50" stroke="#C4342D" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
      <path d="M18 26C18 18 24 12 32 12C40 12 46 18 46 26" fill="#C4342D" opacity="0.2" />
      <path d="M32 12C28 16 26 22 26 26" stroke="#C4342D" strokeWidth="1.5" opacity="0.3" />
      <path d="M32 12C36 16 38 22 38 26" stroke="#C4342D" strokeWidth="1.5" opacity="0.3" />
      <path d="M22 50C22 50 26 46 32 50C38 46 42 50 42 50" stroke="#C4342D" strokeWidth="1.5" opacity="0.15" strokeLinecap="round" />
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
  { label: "San Francisco", searchValue: "San Francisco, CA", icon: <GoldenGate /> },
  { label: "New York", searchValue: "New York, NY", icon: <StatueOfLiberty /> },
  { label: "Los Angeles", searchValue: "Los Angeles, CA", icon: <PalmTree /> },
  { label: "Chicago", searchValue: "Chicago, IL", icon: <Skyline /> },
  { label: "Miami", searchValue: "Miami, FL", icon: <BeachUmbrella /> },
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
