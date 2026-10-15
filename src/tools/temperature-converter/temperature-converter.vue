<script setup lang="ts">
import _ from 'lodash';
import {
  convertCelsiusToKelvin,
  convertDelisleToKelvin,
  convertFahrenheitToKelvin,
  convertKelvinToCelsius,
  convertKelvinToDelisle,
  convertKelvinToFahrenheit,
  convertKelvinToNewton,
  convertKelvinToRankine,
  convertKelvinToReaumur,
  convertKelvinToRomer,
  convertNewtonToKelvin,
  convertRankineToKelvin,
  convertReaumurToKelvin,
  convertRomerToKelvin,
} from './temperature-converter.models';

const temperatureScales = ['kelvin', 'celsius', 'fahrenheit', 'rankine', 'delisle', 'newton', 'reaumur', 'romer'] as const;
type TemperatureScale = typeof temperatureScales[number];
type TemperatureUnit = {
  title: string
  unit: string
  ref: number
  toKelvin: (value: number) => number
  fromKelvin: (value: number) => number
};

const units = reactive<Record<TemperatureScale, TemperatureUnit>>({
        kelvin: {
          title: 'Kelvin',
          unit: 'K',
          ref: 0,
          toKelvin: _.identity,
          fromKelvin: _.identity,
        },
        celsius: {
          title: 'Celsius',
          unit: '°C',
          ref: 0,
          toKelvin: convertCelsiusToKelvin,
          fromKelvin: convertKelvinToCelsius,
        },
        fahrenheit: {
          title: 'Fahrenheit',
          unit: '°F',
          ref: 0,
          toKelvin: convertFahrenheitToKelvin,
          fromKelvin: convertKelvinToFahrenheit,
        },
        rankine: {
          title: 'Rankine',
          unit: '°R',
          ref: 0,
          toKelvin: convertRankineToKelvin,
          fromKelvin: convertKelvinToRankine,
        },
        delisle: {
          title: 'Delisle',
          unit: '°De',
          ref: 0,
          toKelvin: convertDelisleToKelvin,
          fromKelvin: convertKelvinToDelisle,
        },
        newton: {
          title: 'Newton',
          unit: '°N',
          ref: 0,
          toKelvin: convertNewtonToKelvin,
          fromKelvin: convertKelvinToNewton,
        },
        reaumur: {
          title: 'Réaumur',
          unit: '°Ré',
          ref: 0,
          toKelvin: convertReaumurToKelvin,
          fromKelvin: convertKelvinToReaumur,
        },
        romer: {
          title: 'Rømer',
          unit: '°Rø',
          ref: 0,
          toKelvin: convertRomerToKelvin,
          fromKelvin: convertKelvinToRomer,
        },
      });

const unitEntries = computed(() => temperatureScales.map(key => ({ key, config: units[key] })));

function update(key: TemperatureScale) {
  // Convert the selected value to kelvins, then update each other scale from that value.
  const { ref: value, toKelvin } = units[key];

  const kelvins = toKelvin(value) ?? 0;

  for (const scale of temperatureScales) {
    if (scale === key) {
      continue;
    }

    const unit = units[scale];
    unit.ref = Math.floor((unit.fromKelvin(kelvins) ?? 0) * 100) / 100;
  }
}

update('kelvin');
</script>

<template>
  <div>
    <n-input-group v-for="{ key, config } in unitEntries" :key="key" mb-3 w-full>
      <n-input-group-label style="width: 100px">
        {{ config.title }}
      </n-input-group-label>

      <n-input-number
        v-model:value="config.ref"
        style="flex: 1"
        @update:value="() => update(key as TemperatureScale)"
      />

      <n-input-group-label style="width: 50px">
        {{ config.unit }}
      </n-input-group-label>
    </n-input-group>
  </div>
</template>
