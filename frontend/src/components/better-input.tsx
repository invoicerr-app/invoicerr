import {
  InputBase,
  InputBaseAdornment,
  InputBaseControl,
  InputBaseInput,
} from '@/components/ui/input-base';

interface BetterInputProps extends React.ComponentProps<'input'> {
  prefixAdornment?: React.ReactNode;
  postAdornment?: React.ReactNode;
}

export function BetterInput({ prefixAdornment, postAdornment, ...inputProps }: BetterInputProps) {
  return (
    <InputBase>
      {prefixAdornment && <InputBaseAdornment>{prefixAdornment}</InputBaseAdornment>}
      <InputBaseControl>
        <InputBaseInput {...inputProps} />
      </InputBaseControl>
      {postAdornment && <InputBaseAdornment>{postAdornment}</InputBaseAdornment>}
    </InputBase>
  );
}
