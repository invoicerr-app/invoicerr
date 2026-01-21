'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  id: string;
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  completedSteps: number[];
}

export function StepIndicator({ steps, currentStep, completedSteps }: StepIndicatorProps) {
  return (
    <div className="w-full flex items-center justify-between mb-8">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={cn('flex items-center', index < steps.length - 1 && 'flex-1')}
        >
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full font-semibold transition-colors border',
              completedSteps.includes(index) || index === currentStep
                ? 'bg-white text-black border-black'
                : 'bg-black text-white border border-neutral-300',
            )}
          >
            {completedSteps.includes(index) ? <Check className="h-5 w-5" /> : index + 1}
          </div>

          {index < steps.length - 1 && (
            <div
              className={cn(
                'flex-1 h-1 mx-2 transition-colors',
                completedSteps.includes(index) ? 'bg-white' : 'bg-neutral-800',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
