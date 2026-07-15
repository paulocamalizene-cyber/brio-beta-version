ALTER TABLE public.contacts RENAME TO contatos;
ALTER TABLE public.contatos RENAME COLUMN name TO nome;
ALTER TABLE public.contatos RENAME COLUMN phone TO telefone;
ALTER TABLE public.contatos RENAME COLUMN company TO empresa;

ALTER POLICY "Users read own contacts" ON public.contatos RENAME TO "Users can view own contatos";
ALTER POLICY "Users insert own contacts" ON public.contatos RENAME TO "Users can insert own contatos";
ALTER POLICY "Users update own contacts" ON public.contatos RENAME TO "Users can update own contatos";
ALTER POLICY "Users delete own contacts" ON public.contatos RENAME TO "Users can delete own contatos";