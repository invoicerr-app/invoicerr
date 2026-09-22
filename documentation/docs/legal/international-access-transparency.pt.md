---
title: Transparência sobre o Acesso Internacional
language: pt
---

:::warning Rascunho
Rascunho — ainda não revisto por um advogado.
:::

Esta página é publicada nos termos do artigo 28.º do Regulamento (UE) 2023/2854 (o "Data Act" da UE),
que exige que um prestador de um serviço de tratamento de dados torne públicos (a) as jurisdições a que
está sujeita a infraestrutura das TIC utilizada para tratar os dados desse serviço, e (b) uma descrição
geral das medidas técnicas, organizativas e contratuais que adota para impedir o acesso governamental
a, ou a transferência de, dados não pessoais detidos na União, sempre que esse acesso ou transferência
seja contrário ao direito da União ou de um Estado-Membro. Aplica-se apenas à **oferta alojada** do
Invoicerr — os [Termos de Serviço](./terms-of-service.md), Secção 14.4, incorporam esta página por
referência. Não se aplica ao software autoalojado, que nunca nos envia quaisquer dados.

## 1. Jurisdições

A infraestrutura que trata os dados próprios do Serviço — os dados de conta da sua Empresa e os Seus
Dados (os documentos, registos comerciais e configurações que cria através do Serviço) — está localizada
exclusivamente em **França**, distribuída por dois ambientes:

| Ambiente | Componente | Fornecedor | Jurisdição |
| --- | --- | --- | --- |
| Produção | Infraestrutura aplicacional/Kubernetes, base de dados PostgreSQL gerida e armazenamento de objetos dos documentos | Scaleway SAS | França (região de Paris) |
| Aceitação | Infraestrutura aplicacional, base de dados e armazenamento de documentos — utilizados para validar uma versão antes de esta chegar à produção e, durante o programa beta, pelos participantes desse programa | O próprio Prestador — sem fornecedor terceiro | França |

A linha "Produção" está junto de um único fornecedor, numa única região, acedido através da rede
privada própria da Scaleway e não através da internet pública — a base de dados deixou de ser um elo
separado junto de outro fornecedor ou noutro país. A linha "Aceitação" não tem, em sentido próprio,
nenhum fornecedor: funciona numa infraestrutura que o Prestador opera diretamente, em França, pelo que
não existe nessa cadeia nenhum terceiro a quem uma autoridade estrangeira possa notificar um pedido —
uma posição mais forte nos termos do presente artigo do que a da linha "Produção", e não mais fraca. O
próprio Prestador continua, naturalmente, sujeito ao direito francês e da União Europeia, tal como
qualquer operador do Serviço. Nem um nem outro ambiente, nem os Seus Dados em qualquer deles, são
alojados, replicados (mirror) ou objeto de cópia de segurança fora de França/da UE. Sempre que um
subcontratante identificado na
[Política de Privacidade](./privacy-policy.md), Secção 4, e no
[Acordo de Tratamento de Dados](./data-processing-agreement.md), Secção 7 (Polar para a faturação da
subscrição, Resend para o correio eletrónico transacional, Cloudflare e Google LLC para a correspondência
de suporte recebida) seja uma entidade não pertencente à UE ou possa tratar dados fora do EEE, esse
tratamento limita-se aos dados de conta/faturação ou à correspondência de suporte — nunca aos Seus Dados
nem aos documentos que cria através do Serviço — e baseia-se nas garantias próprias desse prestador ao
abrigo do Capítulo V do RGPD, conforme descrito na Política de Privacidade, Secção 5.

Dois sítios web públicos e estáticos — o sítio de marketing (`invoicerr.app`) e este sítio de
documentação (`docs.invoicerr.app`) — estão alojados no **GitHub Pages**, operado pela GitHub, Inc.
(EUA, uma subsidiária integral da Microsoft Corporation). Nenhum dos dois sítios constitui
infraestrutura das TIC que trate os dados do Serviço: como referem tanto o
[Aviso Legal](./legal-notice.md), Secção 3, como a Política de Privacidade, Secção 10, a GitHub nunca
recebe nem armazena os dados de conta, de faturação ou de documentos criados através do Serviço — apenas
o tráfego de visitantes normalmente necessário para servir uma página estática. São aqui indicados por
uma questão de exaustividade, e não por se enquadrarem no âmbito visado pelo artigo 28.º.

## 2. Medidas Contra o Acesso Internacional Ilícito

- **Residência dos dados desde a conceção.** A base de dados e o armazenamento de documentos próprios do
  Serviço estão alojados apenas em França, nos dois ambientes descritos na Secção 1, acima — uma
  escolha, e não uma predefinição, que por si só mantém os dados fora do alcance de qualquer pedido de
  acesso que não passe por uma via jurídica da UE ou francesa. O ambiente de aceitação vai ainda mais
  longe: como o Prestador o aloja diretamente, não existe nessa cadeia qualquer fornecedor terceiro que
  uma autoridade estrangeira pudesse coagir.
- **Encriptação em trânsito.** Todo o tráfego de e para o Serviço é encriptado de ponta a ponta através
  de TLS, com terminação ao nível do ingress mediante um certificado emitido e renovado automaticamente
  (cert-manager / Let's Encrypt) — ver `deploy/helm/invoicerr/templates/ingress.yaml`.
- **Encriptação em repouso das credenciais de ligação.** As credenciais e os tokens que o Serviço
  armazena para ligar a sua Empresa a um canal ou plataforma de terceiros (um transporte de faturação
  eletrónica, um fornecedor OIDC, um certificado de assinatura, um segredo de webhook) são encriptados
  em repouso com AES-256-GCM antes de serem escritos na base de dados — ver
  `backend/src/utils/secret-crypto.ts` — pelo que uma simples cópia da base de dados não os expõe.
- **Encriptação das cópias de segurança.** As cópias de segurança dos documentos e ficheiros
  armazenados pelo Serviço são encriptadas (AES-256-GCM) antes de saírem da nossa infraestrutura, com
  uma chave que o fornecedor de armazenamento nunca detém — ver o Acordo de Tratamento de Dados,
  Secção 9 — pelo que um pedido dirigido diretamente a esse fornecedor, ou uma cópia do próprio
  armazenamento de cópias de segurança, apenas alcança texto cifrado, nunca os documentos.
- **Controlo de acesso.** O acesso aos dados de uma Empresa dentro do Serviço é delimitado pelas funções
  próprias dessa Empresa (proprietário/administrador/membro); o acesso à infraestrutura de produção e
  aos dados dentro da nossa própria organização está limitado ao que é necessário para operar e apoiar o
  Serviço, conforme descrito na Política de Privacidade, Secção 7, e no Acordo de Tratamento de Dados,
  Secção 9.
- **Garantias contratuais com os subcontratantes.** Cada subcontratante está vinculado, por contrato, a
  obrigações de proteção de dados materialmente equivalentes ao Acordo de Tratamento de Dados
  (artigo 28.º, n.º 4, do RGPD) — ver o Acordo de Tratamento de Dados, Secção 7 — e, sempre que um
  subcontratante possa tratar dados fora do EEE, às Cláusulas Contratuais-Tipo da Comissão Europeia ou a
  outra garantia prevista no Capítulo V do RGPD.
- **Ausência de acesso permanente ou automatizado para uma autoridade estrangeira.** Não concedemos a
  nenhum governo, autoridade ou terceiro acesso permanente, automatizado ou backdoor à infraestrutura ou
  base de dados descritas na Secção 1. Qualquer pedido dos Seus Dados por parte de uma autoridade pública
  teria de ser feito através de um instrumento juridicamente vinculativo reconhecido pelo direito da UE
  ou francês; na sua ausência, será recusado. Sempre que tal nos seja legalmente permitido, notificaremos
  a Empresa em causa antes de divulgar quaisquer dados em resposta a tal pedido.

## 3. Atualização Desta Página

Esta página é atualizada sempre que a jurisdição da infraestrutura própria do Serviço, ou as medidas
acima descritas, sofram uma alteração material — o mesmo compromisso que os
[Termos de Serviço](./terms-of-service.md), Secção 20.1, assumem para esse documento. Trata-se de
material de referência: acessível em `GET /api/legal/documents`, tal como qualquer documento aí indicado,
mas — tal como o Aviso Legal, o Acordo de Tratamento de Dados e a Política de Cookies e Utilização
Aceitável — a sua aceitação nunca é exigida para utilizar o Serviço.

## 4. Contacto

As questões relativas a esta página podem ser enviadas para **contact@invoicerr.app**.
