import { Module } from '@nestjs/common';

import { AddressAutocompleteController } from './address-autocomplete.controller';
import { AddressAutocompleteService } from './address-autocomplete.service';

@Module({
  controllers: [AddressAutocompleteController],
  providers: [AddressAutocompleteService],
})
export class AddressAutocompleteModule {}
