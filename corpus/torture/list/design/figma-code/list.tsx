const assetPathPrefix = "https://www.figma.com/api/mcp/asset/04414c6e-dbce-4171-a099-aac691120c71";
const imgBell = `${assetPathPrefix}/06b0f.svg`;
const imgChevron = `${assetPathPrefix}/b1d77.svg`;
const imgLock = `${assetPathPrefix}/d7a22.svg`;
const imgCard = `${assetPathPrefix}/c0398.svg`;
const imgGlobe = `${assetPathPrefix}/e3d26.svg`;

export default function TList() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative size-full" data-node-id="2:160" data-name="t-list">
      <div className="content-stretch flex flex-col items-start overflow-clip pb-[8px] pt-[24px] px-[20px] relative shrink-0 w-full" data-node-id="2:161" data-name="header">
        <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[16px] not-italic relative shrink-0 text-[#667085] text-[12px] tracking-[0.48px] whitespace-nowrap" data-node-id="2:162">
          ACCOUNT
        </p>
      </div>
      <div className="content-stretch flex flex-col items-start overflow-clip relative shrink-0 w-full" data-node-id="2:163" data-name="rows">
        <div className="content-stretch flex gap-[12px] h-[56px] items-center overflow-clip pl-[20px] pr-[16px] relative shrink-0 w-full" data-node-id="2:164" data-name="row">
          <div className="relative shrink-0 size-[24px]" data-node-id="2:165" data-name="bell">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgBell} />
          </div>
          <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Medium'] font-medium leading-[24px] min-w-px not-italic relative text-[#101828] text-[16px]" data-node-id="2:167">
            Notifications
          </p>
          <p className="[word-break:break-word] font-['Inter:Regular'] font-normal leading-[20px] not-italic relative shrink-0 text-[#667085] text-[15px] whitespace-nowrap" data-node-id="2:168">
            On
          </p>
          <div className="relative shrink-0 size-[20px]" data-node-id="2:169" data-name="chevron">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgChevron} />
          </div>
        </div>
        <div className="content-stretch flex items-start overflow-clip pl-[56px] relative shrink-0 w-full" data-node-id="2:171" data-name="divider">
          <div className="bg-[#eaecf0] flex-[1_0_0] h-px min-w-px relative" data-node-id="2:172" data-name="Rectangle" />
        </div>
        <div className="content-stretch flex gap-[12px] h-[56px] items-center overflow-clip pl-[20px] pr-[16px] relative shrink-0 w-full" data-node-id="2:173" data-name="row">
          <div className="relative shrink-0 size-[24px]" data-node-id="2:174" data-name="lock">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgLock} />
          </div>
          <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Medium'] font-medium leading-[24px] min-w-px not-italic relative text-[#101828] text-[16px]" data-node-id="2:176">
            Privacy and security
          </p>
          <div className="relative shrink-0 size-[20px]" data-node-id="2:177" data-name="chevron">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgChevron} />
          </div>
        </div>
        <div className="content-stretch flex items-start overflow-clip pl-[56px] relative shrink-0 w-full" data-node-id="2:179" data-name="divider">
          <div className="bg-[#eaecf0] flex-[1_0_0] h-px min-w-px relative" data-node-id="2:180" data-name="Rectangle" />
        </div>
        <div className="content-stretch flex gap-[12px] h-[56px] items-center overflow-clip pl-[20px] pr-[16px] relative shrink-0 w-full" data-node-id="2:181" data-name="row">
          <div className="relative shrink-0 size-[24px]" data-node-id="2:182" data-name="card">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgCard} />
          </div>
          <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Medium'] font-medium leading-[24px] min-w-px not-italic relative text-[#101828] text-[16px]" data-node-id="2:184">
            Payment methods
          </p>
          <p className="[word-break:break-word] font-['Inter:Regular'] font-normal leading-[20px] not-italic relative shrink-0 text-[#667085] text-[15px] whitespace-nowrap" data-node-id="2:185">
            2 cards
          </p>
          <div className="relative shrink-0 size-[20px]" data-node-id="2:186" data-name="chevron">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgChevron} />
          </div>
        </div>
        <div className="content-stretch flex items-start overflow-clip pl-[56px] relative shrink-0 w-full" data-node-id="2:188" data-name="divider">
          <div className="bg-[#eaecf0] flex-[1_0_0] h-px min-w-px relative" data-node-id="2:189" data-name="Rectangle" />
        </div>
        <div className="content-stretch flex gap-[12px] h-[56px] items-center overflow-clip pl-[20px] pr-[16px] relative shrink-0 w-full" data-node-id="2:190" data-name="row">
          <div className="relative shrink-0 size-[24px]" data-node-id="2:191" data-name="globe">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgGlobe} />
          </div>
          <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Medium'] font-medium leading-[24px] min-w-px not-italic relative text-[#101828] text-[16px]" data-node-id="2:193">
            Language
          </p>
          <p className="[word-break:break-word] font-['Inter:Regular'] font-normal leading-[20px] not-italic relative shrink-0 text-[#667085] text-[15px] whitespace-nowrap" data-node-id="2:194">
            English
          </p>
          <div className="relative shrink-0 size-[20px]" data-node-id="2:195" data-name="chevron">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgChevron} />
          </div>
        </div>
      </div>
      <div className="h-[64px] overflow-clip relative shrink-0 w-full" data-node-id="2:197" data-name="chips">
        <div className="absolute content-stretch flex gap-[8px] items-start left-0 overflow-clip px-[20px] top-[14px]" data-node-id="2:198" data-name="track">
          <div className="bg-[#101828] content-stretch flex items-start overflow-clip px-[14px] py-[8px] relative rounded-[18px] shrink-0" data-node-id="2:199" data-name="chip">
            <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[14px] text-white whitespace-nowrap" data-node-id="2:200">
              All
            </p>
          </div>
          <div className="bg-[#f2f4f7] content-stretch flex items-start overflow-clip px-[14px] py-[8px] relative rounded-[18px] shrink-0" data-node-id="2:201" data-name="chip">
            <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#344054] text-[14px] whitespace-nowrap" data-node-id="2:202">
              Transfers
            </p>
          </div>
          <div className="bg-[#f2f4f7] content-stretch flex items-start overflow-clip px-[14px] py-[8px] relative rounded-[18px] shrink-0" data-node-id="2:203" data-name="chip">
            <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#344054] text-[14px] whitespace-nowrap" data-node-id="2:204">
              Card payments
            </p>
          </div>
          <div className="bg-[#f2f4f7] content-stretch flex items-start overflow-clip px-[14px] py-[8px] relative rounded-[18px] shrink-0" data-node-id="2:205" data-name="chip">
            <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#344054] text-[14px] whitespace-nowrap" data-node-id="2:206">
              Subscriptions
            </p>
          </div>
          <div className="bg-[#f2f4f7] content-stretch flex items-start overflow-clip px-[14px] py-[8px] relative rounded-[18px] shrink-0" data-node-id="2:207" data-name="chip">
            <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#344054] text-[14px] whitespace-nowrap" data-node-id="2:208">
              Cashback
            </p>
          </div>
        </div>
      </div>
      <div className="content-stretch flex flex-col gap-[16px] items-start overflow-clip pb-[20px] relative shrink-0 w-full" data-node-id="2:209" data-name="full-divider">
        <div className="bg-[#eaecf0] h-px relative shrink-0 w-full" data-node-id="2:210" data-name="Rectangle" />
        <div className="content-stretch flex flex-col items-start overflow-clip px-[20px] relative shrink-0 w-full" data-node-id="2:211" data-name="note">
          <p className="[word-break:break-word] font-['Inter:Regular'] font-normal leading-[20px] not-italic relative shrink-0 text-[#667085] text-[14px] whitespace-nowrap" data-node-id="2:212">
            Signed in as alex@example.com
          </p>
        </div>
      </div>
    </div>
  );
}
