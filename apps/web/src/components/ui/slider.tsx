import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  let _values: readonly number[] = [min, max];
  if (Array.isArray(value)) {
    _values = value;
  } else if (Array.isArray(defaultValue)) {
    _values = defaultValue;
  }
  // Thumbs have no identity beyond their position in the value array.
  const thumbKeys = Array.from(
    { length: _values.length },
    (_, index) => `thumb-${index}`
  );

  return (
    <SliderPrimitive.Root
      className={cn("data-vertical:h-full data-horizontal:w-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      max={max}
      min={min}
      thumbAlignment="edge"
      value={value}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none select-none items-center data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col data-disabled:opacity-50">
        <SliderPrimitive.Track
          className="relative grow select-none overflow-hidden rounded-md bg-muted data-horizontal:h-1 data-vertical:h-full data-horizontal:w-full data-vertical:w-1"
          data-slot="slider-track"
        >
          <SliderPrimitive.Indicator
            className="select-none bg-primary data-horizontal:h-full data-vertical:w-full"
            data-slot="slider-range"
          />
        </SliderPrimitive.Track>
        {thumbKeys.map((thumbKey) => (
          <SliderPrimitive.Thumb
            className="relative block size-3 shrink-0 select-none rounded-md border border-ring bg-white ring-ring/30 transition-[color,box-shadow] after:absolute after:-inset-2 hover:ring-2 focus-visible:outline-hidden focus-visible:ring-2 active:ring-2 disabled:pointer-events-none disabled:opacity-50"
            data-slot="slider-thumb"
            key={thumbKey}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
