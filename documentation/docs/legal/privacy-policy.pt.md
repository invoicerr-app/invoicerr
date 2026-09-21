---
title: Política de Privacidade
language: pt
---

:::warning Draft
Rascunho — ainda não revisto por um advogado.
:::

Esta Política de Privacidade explica como os dados pessoais são tratados no âmbito da **oferta
alojada** do Invoicerr — a versão do Serviço operada no(s) nosso(s) próprio(s) domínio(s), conforme
definido nos [Termos de Serviço](./terms-of-service.md). **Não se aplica ao software autoalojado.**
Quando executa o Invoicerr na sua própria infraestrutura, nunca recebemos, vemos ou tratamos qualquer
um dos seus dados — não há nada de que possamos ser responsável pelo tratamento ou subcontratante, e
esta Política não descreve nada que lhe aconteça. Tudo o que se segue diz respeito apenas ao Serviço
alojado.

## 1. Quem Somos

O responsável pelo tratamento dos dados de conta e de faturação descritos na Secção 3 é **Roméo
Chevrier, empresário em nome individual (entrepreneur individuel)**, registado sob o número **SIREN
982 187 676 (SIRET 982 187 676 00019)**, com morada registada em **4 rue du Puits, 26120 Montélier,
França** ("**nós**", "**nos**", "**o Prestador**"). Contacto: **contact@invoicerr.app**.

Dada a natureza e a escala do nosso tratamento de dados, não somos obrigados, nos termos do **artigo
37.º do RGPD**, a nomear um Encarregado de Proteção de Dados. Utilize o contacto acima para qualquer
questão ou pedido ao abrigo desta Política.

## 2. Dois Papéis, Dois Tipos de Dados

Tal como os Termos de Serviço (Secção 15.1), esta Política distingue dois papéis:

- **Somos o responsável pelo tratamento** dos seus próprios **dados de conta** — as informações sobre
  si e a sua Empresa necessárias para gerir a sua subscrição (Secção 3, abaixo).
- **Somos apenas o subcontratante**, agindo de acordo com as suas instruções documentadas,
  relativamente aos dados pessoais que insere nos documentos que cria ou recebe através do Serviço —
  nomes, moradas e outros dados semelhantes dos seus clientes ou contactos numa fatura ou orçamento.
  Esse tratamento é regido pelo [Acordo de Tratamento de Dados](./data-processing-agreement.md), e não
  por esta Política: continua a ser o responsável pelo tratamento desses dados, sendo responsável pelo
  seu próprio aviso de privacidade perante os seus clientes.

## 3. O Que Recolhemos, na Qualidade de Responsável pelo Tratamento, e Porquê

Recolhemos todos os dados abaixo **diretamente de si**, quer quando os fornece (registo, configuração,
apoio ao cliente), quer automaticamente à medida que utiliza o Serviço (dados de ligação e de
segurança).

| Dados | Exemplos | Finalidade | Fundamento jurídico (artigo 6.º do RGPD) |
| --- | --- | --- | --- |
| Dados de conta | nome, email, palavra-passe encriptada (hash), tokens de sessão | permitir-lhe iniciar sessão e utilizar o Serviço | Execução de um contrato (art. 6.º, n.º 1, alínea b)) |
| Dados da Empresa | nome da empresa, morada, identificadores nacionais que configura (por exemplo, SIREN/NIF) | gerir o espaço de trabalho da sua Empresa, preencher os documentos que emite | Execução de um contrato (art. 6.º, n.º 1, alínea b)) |
| Dados de subscrição | plano, número de lugares (seats), estado da subscrição, datas do período experimental | gerir a sua subscrição; a Polar processa e armazena o seu meio de pagamento e morada de faturação na qualidade de merchant of record — ver Secção 5 | Execução de um contrato (art. 6.º, n.º 1, alínea b)) |
| Dados de ligação e de segurança | endereço IP, registos temporais dos eventos de autenticação, registos (logs) da aplicação | detetar abusos, manter o Serviço seguro, diagnosticar incidentes | Interesse legítimo (art. 6.º, n.º 1, alínea f)) |
| Prova de aceitação | qual o documento legal e a versão que aceitou, quando, bem como o endereço IP e o agente de utilizador do navegador a partir dos quais o aceitou | demonstrar que aceitou o texto em vigor no momento em que o aceitou | Execução de um contrato (art. 6.º, n.º 1, alínea b)) e o nosso interesse legítimo em poder fazer prova dessa aceitação (art. 6.º, n.º 1, alínea f)) |
| Comunicações de apoio ao cliente | o conteúdo dos emails que envia para contact@invoicerr.app | responder ao seu pedido | Interesse legítimo (art. 6.º, n.º 1, alínea f)), ou execução de um contrato quando o pedido diz respeito à sua subscrição |
| Registos de faturação para a nossa própria contabilidade | a identidade da sua Empresa e os montantes que lhe são faturados | a nossa própria obrigação legal de contabilidade | Obrigação legal (art. 6.º, n.º 1, alínea c)) |

Não enviamos mensagens de marketing por email para além das comunicações transacionais relativas à sua
conta e subscrição (por exemplo, avisos de início de sessão, de faturação e do serviço) — não existe
um fluxo de consentimento de marketing separado a descrever.

## 4. Subcontratantes

Partilhamos os dados de conta e de faturação acima indicados com os seguintes subcontratantes, cada um
vinculado pelos seus próprios termos de tratamento de dados:

- **Polar Software Inc.** — processamento de pagamentos e faturação; atua como **merchant of record**
  da sua subscrição (Termos de Serviço, Secção 7.1) e é, ela própria, responsável pelo tratamento dos
  dados de pagamento que recolhe diretamente de si.
- **Resend** — entrega de emails transacionais enviados pelo Serviço (ligações de início de sessão,
  notificações).
- **Cloudflare, Inc.** — encaminhamento de correio eletrónico de entrada para a correspondência
  enviada para **contact@invoicerr.app** (apenas correspondência de apoio ao cliente; a Cloudflare
  nunca vê os dados contidos nos documentos que cria através do Serviço).
- **Google LLC (Gmail)** — a caixa de correio onde é recebida a correspondência de apoio ao cliente
  enviada para **contact@invoicerr.app** (apenas correspondência de apoio ao cliente; a Google nunca vê
  os dados contidos nos documentos que cria através do Serviço).
- **Scaleway SAS** — alojamento da infraestrutura do **ambiente de produção** do Serviço: o cluster
  Kubernetes onde este é executado, a base de dados PostgreSQL gerida que armazena os dados da Empresa
  e da conta descritos na Secção 3, bem como os documentos que cria através do Serviço, e o
  armazenamento de objetos (object storage) que contém os documentos arquivados. **O Serviço e os Dados
  do Cliente, incluindo a base de dados, estão alojados na União Europeia**, na região de Paris (França)
  da Scaleway, sendo a base de dados acedida através da rede privada própria da Scaleway e não através
  da internet pública.

**O ambiente de aceitação utilizado para o programa beta.** Antes de uma versão chegar à
infraestrutura de produção acima descrita, validamo-la num ambiente de aceitação separado, que o
Prestador opera diretamente, na sua própria infraestrutura, em França — nenhum terceiro o aloja, razão
pela qual não figura acima como subcontratante. Durante o programa beta, os participantes do programa
utilizam o Serviço neste ambiente de aceitação em vez do ambiente de produção da Scaleway, e os seus
Dados do Cliente — incluindo faturas reais, clientes reais e outros registos comerciais reais — são aí
armazenados. Quando o ambiente de aceitação utilizado para o programa beta for retirado, esses dados são
transferidos para a infraestrutura de produção acima descrita.

**O OCR (reconhecimento ótico de caracteres) é executado em infraestrutura que operamos; nenhum
documento é enviado a um fornecedor de OCR terceiro.**

**Não são subcontratantes nossos:** os prestadores de pagamento que liga para que os **seus próprios
clientes** possam pagar as faturas que emite — Stripe, Mollie, PayPal — são **as suas próprias
contas**, contratadas diretamente entre si e esses prestadores (Termos de Serviço, Secção 14.3). As
**plataformas nacionais de faturação eletrónica e governamentais** que opta por ligar (a PDP francesa,
o KSeF polaco, o SdI italiano, a AT portuguesa, a Chorus Pro francesa) atuam por sua própria instrução
e mandato para transmitir os documentos que envia; o seu papel relativamente aos dados pessoais
contidos nesses documentos é tratado no Acordo de Tratamento de Dados, e não nesta Política, que é
dirigida ao responsável pelo tratamento.

## 5. Transferências Internacionais

Alguns dos subcontratantes acima (Polar, Resend, Cloudflare, Google LLC) podem tratar dados fora do
Espaço Económico Europeu, incluindo nos Estados Unidos. Nesses casos, a transferência baseia-se nas
garantias adequadas próprias desse prestador ao abrigo do Capítulo V do RGPD (tais como as Cláusulas
Contratuais-Tipo da Comissão Europeia). Esta secção é uma declaração de caráter geral, e não uma
afirmação sobre a certificação atual de qualquer prestador em concreto — escreva para
contact@invoicerr.app para saber qual o mecanismo específico em que um determinado prestador se baseia
atualmente. **A Scaleway SAS não consta desta lista**: é uma empresa francesa que aloja a base de dados
PostgreSQL gerida da Empresa, além da infraestrutura Kubernetes e do armazenamento de objetos já
descritos na Secção 4, inteiramente dentro da sua região de Paris (França) — nenhum elo da cadeia que
armazena os documentos que cria, ou os dados de conta e de base de dados da sua Empresa, envolve uma
entidade fora da UE.

## 6. Conservação

- **Os dados de conta e da Empresa** são conservados enquanto a sua Empresa existir no Serviço, sendo
  depois tratados exatamente como descrito nos Termos de Serviço, Secção 13: uma Empresa que nunca
  converte a partir do período experimental é eliminada **não antes de 30 dias** após o arquivo de fim
  de período experimental ter sido enviado (Secção 13.3, primeiro ponto — a constante
  `MIN_RETRIEVAL_DAYS` do próprio `billing/lifecycle.ts`); uma Empresa que teve uma subscrição paga é
  eliminada **não antes de 180 dias** após o envio desse arquivo (Secção 13.3, segundo ponto — a
  constante `PAID_ZIP_GRACE_DAYS` desse mesmo ficheiro). Ambos os valores correspondem ao período
  mínimo de recuperação de dados exigido pelo artigo 25.º, n.º 2, alínea g), do Regulamento (UE)
  2023/2854 (o Data Act da UE), antes de podermos apagar os Seus Dados assim que deixar de utilizar o
  Serviço.
- **Os documentos arquivados ainda dentro de um prazo legal de conservação sobrevivem a essa
  eliminação.** Quando envia um documento através do Serviço, arquivamos uma cópia do mesmo e
  registamos, nesse momento, durante quanto tempo a lei do país da sua Empresa exige que seja
  conservado e qual o texto que impõe esse prazo. Quando a sua Empresa é eliminada — por si, a partir
  das definições da sua Empresa, a qualquer momento e sem que bloqueemos a sua saída, ou no final do
  calendário acima descrito — desaparecem todos os registos a ela associados e todos os ficheiros
  armazenados, **exceto** os documentos arquivados cujo prazo registado ainda não decorreu. Esses
  ficheiros permanecem no nosso armazenamento, acompanhados de um registo que indica, para cada um, a
  data de caducidade e a respetiva citação legal, e apagamo-los assim que essa data tiver passado. O
  fundamento é o **artigo 17.º, n.º 3, alínea b), do RGPD**: o direito ao apagamento não se aplica na
  medida em que o tratamento seja necessário ao cumprimento de uma obrigação jurídica que exija o
  tratamento, prevista pelo direito da União ou do Estado-Membro a que o responsável pelo tratamento
  esteja sujeito — e uma obrigação nacional de conservação de faturas não cessa pelo facto de uma conta
  ter sido encerrada. Os prazos que aplicamos, cada um retirado do texto que o impõe: **Alemanha**, 8
  anos a contar do fim do ano civil de emissão do documento (UStG § 14b Abs. 1; AO § 147 Abs. 3);
  **França**, o mais longo entre 6 anos (LPF art. L102 B) e 10 anos (C. com. art. L123-22), que
  vinculam em simultâneo uma sociedade francesa; **Polónia**, 5 anos (ustawa o VAT art. 112, que remete
  para o prazo de prescrição da Ordynacja podatkowa art. 70 § 1); **Portugal**, 10 anos a contar do fim
  do ano civil de emissão (CIVA art. 52.º n.º 1). Estes quatro países são os únicos para os quais o
  Serviço dispõe de uma regra de conservação documentada: para uma Empresa estabelecida noutro local,
  nada é retido e os seus documentos arquivados são apagados juntamente com tudo o resto. Dito de forma
  clara: **se a sua Empresa estiver estabelecida num destes quatro países, os documentos que enviou
  através do Serviço permanecem no nosso armazenamento durante anos após a sua saída**, e não os
  apagaremos mais cedo a seu pedido.
- Os **registos (logs) da aplicação** são conservados durante **90 dias**, sendo depois eliminados
  automaticamente por uma purga recorrente — tempo suficiente para instruir um incidente de segurança
  ou um pedido de apoio que só surja semanas mais tarde, e não mais do que isso.
- Os **registos de sessão** — uma linha por cada início de sessão, com o endereço IP e o agente de
  utilizador do navegador a partir dos quais foi criada — são eliminados quando termina a sessão e,
  caso contrário, conservados enquanto a sua conta existir. A eliminação da sua conta elimina-os com
  ela.
- A **sua aceitação dos presentes documentos** — a data, o documento e a versão aceites, bem como o
  endereço IP e o agente de utilizador a partir dos quais foi dada — é conservada enquanto a sua conta
  existir. Conservamo-la porque constitui a prova de que aceitou exatamente a versão que aceitou; é
  eliminada juntamente com a sua conta.
- As **comunicações de apoio ao cliente** são conservadas durante o tempo necessário para resolver o
  seu pedido e por um período razoável adicional, caso pretenda dar seguimento ao assunto.

## 7. Segurança

As credenciais e os tokens utilizados para ligar a sua Empresa a canais e plataformas de terceiros são
encriptados em repouso (AES-256-GCM); todo o tráfego de e para o Serviço é encriptado em trânsito
(TLS) — as mesmas medidas descritas nos Termos de Serviço, Secção 15.3. O acesso aos seus dados dentro
da nossa própria organização é limitado ao que é necessário para operar e apoiar o Serviço.

## 8. Os Seus Direitos

Ao abrigo do RGPD, tem o direito de: aceder aos dados pessoais que detemos sobre si (**artigo 15.º**);
solicitar a sua retificação (**artigo 16.º**); solicitar o seu apagamento (**artigo 17.º**); limitar o
seu tratamento (**artigo 18.º**); receber uma cópia portável dos mesmos (**artigo 20.º**); e opor-se ao
tratamento baseado no nosso interesse legítimo (**artigo 21.º**). Pode exercer qualquer um destes
direitos escrevendo para **contact@invoicerr.app**; responderemos dentro do prazo que o RGPD fixa para
um responsável pelo tratamento. Tem também o direito de apresentar reclamação junto da autoridade
francesa de proteção de dados, a **CNIL** (www.cnil.fr), ou junto da autoridade de controlo do seu
próprio Estado-Membro da UE.

O direito ao apagamento (**artigo 17.º**) tem um limite que aplicamos e que deve conhecer antes de o
exercer: quando um diploma legal continua a exigir a conservação de um documento arquivado, o
**artigo 17.º, n.º 3, alínea b)** afasta esse direito enquanto durar o prazo de conservação, e nós
conservamos o documento. A Secção 6 indica quais os países, os prazos e os textos em causa, e o que é
apagado de qualquer forma.

Não realizamos qualquer tratamento do tipo descrito no **artigo 22.º do RGPD** — não existe qualquer
decisão automatizada, incluindo definição de perfis (profiling), que produza efeitos jurídicos ou
similarmente significativos sobre si.

Para a exportação completa em regime de self-service, a exportação do livro-razão contabilístico e a
exportação automática de dados no final da subscrição, ver os Termos de Serviço, Secções 8.2 e 13.2 —
as três constituem também a forma prática de exercer a portabilidade.

## 9. Cookies e Outros Armazenamentos no Navegador

O Serviço define dois cookies — um para manter a sua sessão iniciada e outro para memorizar se deixou o
menu lateral de navegação aberto — e conserva algumas preferências de interface no armazenamento local
do seu próprio navegador. Nada disto é utilizado para medição de audiências, publicidade ou definição
de perfis, e nenhum terceiro define o que quer que seja através do Serviço. Consulte
[Cookies e Política de Utilização Aceitável](./cookies-and-acceptable-use.md) para a lista completa, a
finalidade e a duração de cada elemento, e os motivos pelos quais não é apresentado nenhum aviso
(banner) de consentimento.

## 10. Sites Que Operamos

O próprio Serviço é executado em **my.invoicerr.app**, alojado pela Scaleway conforme descrito na
Secção 4. Separadamente do Serviço, publicamos dois sites públicos e estáticos, ambos servidos pelo
**GitHub Pages** — um serviço de alojamento operado pela **GitHub, Inc.**, 88 Colin P. Kelly Jr.
Street, San Francisco, CA 94107, EUA, uma subsidiária integral da Microsoft Corporation:

- **invoicerr.app** — o nosso site público de marketing. Não define nenhum cookie nem carrega qualquer
  script de análise (analytics), publicidade ou rastreio de qualquer tipo. O tema claro/escuro que
  escolhe é guardado apenas no `localStorage` do seu navegador, uma preferência puramente local que
  nunca chega até nós e não transporta quaisquer dados pessoais. A página efetua uma chamada a partir
  do **seu próprio navegador** para `api.github.com` (a API pública do GitHub) para apresentar o nosso
  número atual de estrelas no GitHub; esse pedido é feito diretamente pelo seu navegador, sem passar
  por nós, pelo que o GitHub vê o endereço IP do visitante da mesma forma que veria em qualquer visita
  direta a github.com — ver a
  [Declaração de Privacidade do GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **docs.invoicerr.app** — o nosso site de documentação, construído com Docusaurus. Não define nenhum
  cookie nem carrega qualquer script de análise, publicidade ou rastreio — a sua pesquisa na página é
  executada inteiramente no seu navegador (ver
  [Cookies e Política de Utilização Aceitável](./cookies-and-acceptable-use.md)).

Visitar qualquer um destes sites envia o seu endereço IP e os cabeçalhos HTTP padrão do pedido para o
GitHub, para que este possa servir a página; trata-se do próprio registo técnico de acesso do GitHub,
que não recebemos nem controlamos. **Nenhum dado de conta, de faturação, ou qualquer outro dado do
Serviço descrito na Secção 3 transita por, ou é armazenado em, qualquer um destes sites.**

O nosso código-fonte também está publicado no GitHub, em
[github.com/invoicerr-app/invoicerr](https://github.com/invoicerr-app/invoicerr). As issues e
discussões aí publicadas são públicas e regem-se pela própria declaração de privacidade e pelos
próprios termos do GitHub, e não por esta Política.

A GitHub, Inc. autocertificou junto do Departamento de Comércio dos EUA que adere ao Quadro de
Proteção de Dados UE-EUA (Data Privacy Framework, DPF), incluindo a Extensão do Reino Unido ao DPF
UE-EUA, para os dados pessoais que recebe da UE/Reino Unido nesta qualidade — a mesma garantia do
Capítulo V referida na Secção 5 para os nossos outros prestadores sediados nos EUA.

## 11. Menores

O Serviço é oferecido estritamente numa base business-to-business (Termos de Serviço, Secção 1.2) e
não se destina a, nem é conscientemente utilizado por, pessoas que atuem fora de uma capacidade
profissional.

## 12. Alterações a Esta Política

Podemos atualizar esta Política periodicamente; a versão e a data de entrada em vigor no topo desta
página identificam a versão em vigor. Sempre que uma alteração for substancial, informá-lo-emos por
email antes de esta produzir efeitos, da mesma forma descrita nos Termos de Serviço, Secção 20.1, para
esse documento.

## 13. Contacto

As questões sobre esta Política, ou um pedido ao abrigo da Secção 8, podem ser enviados para
**contact@invoicerr.app**, ou por correio postal para a morada indicada na Secção 1.

## 14. Língua que prevalece

Este documento é redigido e celebrado em língua inglesa. Sempre que seja disponibilizada uma tradução
para outra língua para sua comodidade e compreensão, essa tradução não substitui o texto em inglês: em
caso de incoerência, ambiguidade ou conflito entre a versão inglesa e uma versão traduzida, **prevalece
a versão inglesa**, sendo esta a que rege os direitos e obrigações das partes. As traduções são
fornecidas de boa-fé para facilitar a compreensão deste documento por cada público; não criam quaisquer
direitos distintos ou adicionais.
